using System.Net.Http.Json;
using System.Text.Json;
using System.Text.Json.Serialization;
using Microsoft.Extensions.Options;

namespace FRD.DataServer.Services;

/// <summary>
/// Periodic background worker that collects metrics + runs Bayesian analysis
/// for all running experiments.
///
/// Tick → GET /api/experiments/running → parallel collect → analyze → POST results
/// </summary>
public sealed class ExperimentWorker : BackgroundService
{
    private readonly IServiceProvider _services;
    private readonly HttpClient _http;
    private readonly ExperimentWorkerOptions _opts;
    private readonly ILogger<ExperimentWorker> _logger;

    private static readonly JsonSerializerOptions JsonOpts = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull,
    };

    public ExperimentWorker(
        IServiceProvider services,
        IHttpClientFactory httpFactory,
        IOptions<ExperimentWorkerOptions> opts,
        ILogger<ExperimentWorker> logger)
    {
        _services = services;
        _http = httpFactory.CreateClient("ExperimentWorker");
        _opts = opts.Value;
        _logger = logger;
        _http.BaseAddress = new Uri(_opts.ApiBaseUrl);
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        _logger.LogInformation(
            "ExperimentWorker started. Interval={Interval}s, MaxConcurrency={MaxConcurrency}",
            _opts.IntervalSeconds, _opts.MaxConcurrency);

        using var timer = new PeriodicTimer(TimeSpan.FromSeconds(_opts.IntervalSeconds));

        // Run once on startup, then on each tick
        await TickAsync(stoppingToken);

        while (await timer.WaitForNextTickAsync(stoppingToken))
        {
            await TickAsync(stoppingToken);
        }
    }

    private async Task TickAsync(CancellationToken ct)
    {
        _logger.LogInformation("[worker] tick — {Time}", DateTime.UtcNow.ToString("O"));

        RunningExperiment[] experiments;
        try
        {
            experiments = await _http.GetFromJsonAsync<RunningExperiment[]>(
                "/api/experiments/running", JsonOpts, ct) ?? [];
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Failed to fetch running experiments");
            return;
        }

        _logger.LogInformation("[worker] {Count} running experiment(s)", experiments.Length);
        if (experiments.Length == 0) return;

        var collector = _services.GetRequiredService<MetricCollector>();
        var analyzer = _services.GetRequiredService<PythonAnalyzer>();

        await Parallel.ForEachAsync(experiments,
            new ParallelOptions { MaxDegreeOfParallelism = _opts.MaxConcurrency, CancellationToken = ct },
            async (exp, token) =>
            {
                await ProcessExperimentAsync(exp, collector, analyzer, token);
            });

        _logger.LogInformation("[worker] tick complete");
    }

    private async Task ProcessExperimentAsync(
        RunningExperiment exp,
        MetricCollector collector,
        PythonAnalyzer analyzer,
        CancellationToken ct)
    {
        _logger.LogInformation("── [{Slug}] processing", exp.Slug);

        // Validate required fields
        var envId = exp.Project?.EnvSecret ?? "";
        var flagKey = exp.Project?.FlagKey ?? "";
        var expId = exp.ExperimentId;

        if (string.IsNullOrEmpty(envId) || string.IsNullOrEmpty(flagKey)
            || string.IsNullOrEmpty(exp.PrimaryMetricEvent))
        {
            _logger.LogWarning("[{Slug}] missing required fields (envSecret/flagKey/primaryMetricEvent)", exp.Slug);
            return;
        }

        // Build params
        var now = DateTimeOffset.UtcNow;
        var p = new ExperimentParams
        {
            Slug = exp.Slug,
            ProjectId = exp.ProjectId,
            EnvId = envId,
            FlagKey = flagKey,
            Method = exp.Method ?? "bayesian_ab",
            ExperimentId = expId,
            LayerId = exp.LayerId,
            TrafficPercent = exp.TrafficPercent,
            TrafficOffset = exp.TrafficOffset,
            AudienceFilters = exp.AudienceFilters,
            MetricEvent = exp.PrimaryMetricEvent!,
            MetricType = exp.PrimaryMetricType ?? "binary",
            MetricAgg = exp.PrimaryMetricAgg ?? "once",
            ControlVariant = exp.ControlVariant ?? "false",
            TreatmentVariant = exp.TreatmentVariant ?? "true",
            Start = exp.ObservationStart != null ? DateTimeOffset.Parse(exp.ObservationStart) : now.AddDays(-30),
            End = exp.ObservationEnd != null ? DateTimeOffset.Parse(exp.ObservationEnd) : now,
        };

        // ── Step 1: Collect metrics ──
        var summary = await collector.CollectAsync(p, ct);
        if (summary == null)
        {
            _logger.LogWarning("[{Slug}] collection returned no data", exp.Slug);
            return;
        }

        _logger.LogInformation("[{Slug}] collected: {Type} control/treatment", exp.Slug, summary.MetricType);

        // ── Step 2: Write inputData to DB ──
        var inputData = new
        {
            collectedAt = DateTime.UtcNow.ToString("O"),
            source = "featbit",
            metricType = summary.MetricType,
            control = summary.Control,
            treatment = summary.Treatment,
        };

        var inputDataJson = JsonSerializer.Serialize(inputData, JsonOpts);
        try
        {
            var resp = await _http.PostAsJsonAsync(
                $"/api/projects/{Uri.EscapeDataString(exp.ProjectId)}/experiment",
                new { slug = exp.Slug, inputData = inputDataJson },
                JsonOpts, ct);
            resp.EnsureSuccessStatusCode();
            _logger.LogInformation("[{Slug}] inputData written", exp.Slug);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "[{Slug}] failed to write inputData", exp.Slug);
            return;
        }

        // ── Step 3: Run Bayesian analysis ──
        var metricKey = exp.PrimaryMetricEvent!;
        var metrics = new Dictionary<string, object>
        {
            [metricKey] = new Dictionary<string, object>
            {
                [p.ControlVariant] = summary.Control,
                [p.TreatmentVariant] = summary.Treatment,
            }
        };

        var analysisInput = new PythonAnalysisInput
        {
            Slug = exp.Slug,
            Metrics = metrics,
            Control = p.ControlVariant,
            Treatments = [p.TreatmentVariant],
            ObservationStart = exp.ObservationStart,
            ObservationEnd = exp.ObservationEnd,
            PriorProper = exp.PriorProper ?? false,
            PriorMean = exp.PriorMean ?? 0.0,
            PriorStddev = exp.PriorStddev ?? 0.3,
            MinimumSample = exp.MinimumSample ?? 0,
        };

        var result = await analyzer.AnalyzeAsync(analysisInput, ct);
        if (result == null)
        {
            _logger.LogWarning("[{Slug}] analysis returned no result", exp.Slug);
            return;
        }

        // ── Step 4: Write analysisResult to DB ──
        try
        {
            var resp = await _http.PostAsJsonAsync(
                $"/api/projects/{Uri.EscapeDataString(exp.ProjectId)}/experiment",
                new { slug = exp.Slug, analysisResult = result.Value.GetRawText(), status = "analyzing" },
                JsonOpts, ct);
            resp.EnsureSuccessStatusCode();
            _logger.LogInformation("[{Slug}] analysisResult written", exp.Slug);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "[{Slug}] failed to write analysisResult", exp.Slug);
        }
    }
}

// ── Configuration ───────────────────────────────────────────────────────────

public sealed class ExperimentWorkerOptions
{
    public int IntervalSeconds { get; set; } = 300;
    public int MaxConcurrency { get; set; } = 8;
    public string ApiBaseUrl { get; set; } = "http://localhost:3000";
    public string PythonPath { get; set; } = "python";
    public string PythonScriptPath { get; set; } = "scripts/analyze-bayesian.py";
}

// ── API response models ─────────────────────────────────────────────────────

public sealed class RunningExperiment
{
    [JsonPropertyName("id")]
    public required string Id { get; init; }

    [JsonPropertyName("projectId")]
    public required string ProjectId { get; init; }

    [JsonPropertyName("slug")]
    public required string Slug { get; init; }

    [JsonPropertyName("status")]
    public string? Status { get; init; }

    [JsonPropertyName("method")]
    public string? Method { get; init; }

    [JsonPropertyName("experimentId")]
    public string? ExperimentId { get; init; }

    [JsonPropertyName("layerId")]
    public string? LayerId { get; init; }

    [JsonPropertyName("trafficPercent")]
    public double? TrafficPercent { get; init; }

    [JsonPropertyName("trafficOffset")]
    public int? TrafficOffset { get; init; }

    [JsonPropertyName("audienceFilters")]
    public string? AudienceFilters { get; init; }

    [JsonPropertyName("primaryMetricEvent")]
    public string? PrimaryMetricEvent { get; init; }

    [JsonPropertyName("primaryMetricType")]
    public string? PrimaryMetricType { get; init; }

    [JsonPropertyName("primaryMetricAgg")]
    public string? PrimaryMetricAgg { get; init; }

    [JsonPropertyName("controlVariant")]
    public string? ControlVariant { get; init; }

    [JsonPropertyName("treatmentVariant")]
    public string? TreatmentVariant { get; init; }

    [JsonPropertyName("observationStart")]
    public string? ObservationStart { get; init; }

    [JsonPropertyName("observationEnd")]
    public string? ObservationEnd { get; init; }

    [JsonPropertyName("priorProper")]
    public bool? PriorProper { get; init; }

    [JsonPropertyName("priorMean")]
    public double? PriorMean { get; init; }

    [JsonPropertyName("priorStddev")]
    public double? PriorStddev { get; init; }

    [JsonPropertyName("minimumSample")]
    public int? MinimumSample { get; init; }

    [JsonPropertyName("project")]
    public ProjectSnapshot? Project { get; init; }
}

public sealed class ProjectSnapshot
{
    [JsonPropertyName("id")]
    public required string Id { get; init; }

    [JsonPropertyName("flagKey")]
    public string? FlagKey { get; init; }

    [JsonPropertyName("envSecret")]
    public string? EnvSecret { get; init; }
}
