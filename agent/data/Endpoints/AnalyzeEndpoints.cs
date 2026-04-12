using System.Text.Json;
using System.Text.Json.Serialization;
using FRD.DataServer.Services;

namespace FRD.DataServer.Endpoints;

public static class AnalyzeEndpoints
{
    private static readonly JsonSerializerOptions JsonOpts = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull,
    };

    public static void MapAnalyzeEndpoints(this WebApplication app)
    {
        app.MapPost("/analyze", HandleAnalyze);
    }

    private static async Task<IResult> HandleAnalyze(
        HttpRequest httpRequest,
        MetricCollector collector,
        PythonAnalyzer analyzer,
        ILogger<MetricCollector> logger,
        CancellationToken ct)
    {
        AnalyzeRequest req;
        try
        {
            req = await httpRequest.ReadFromJsonAsync<AnalyzeRequest>(JsonOpts, ct)
                  ?? throw new InvalidOperationException("Empty body");
        }
        catch (Exception ex)
        {
            return Results.BadRequest(new { error = $"Invalid request body: {ex.Message}" });
        }

        // Validate required fields
        if (string.IsNullOrEmpty(req.EnvId) || string.IsNullOrEmpty(req.FlagKey)
            || string.IsNullOrEmpty(req.PrimaryMetricEvent))
        {
            return Results.BadRequest(new { error = "envId, flagKey, and primaryMetricEvent are required" });
        }

        var now = DateTimeOffset.UtcNow;
        var p = new ExperimentParams
        {
            Slug = req.Slug ?? "on-demand",
            ProjectId = req.ProjectId ?? "",
            EnvId = req.EnvId,
            FlagKey = req.FlagKey,
            Method = req.Method ?? "bayesian_ab",
            ExperimentId = req.ExperimentId,
            LayerId = req.LayerId,
            TrafficPercent = req.TrafficPercent,
            TrafficOffset = req.TrafficOffset,
            AudienceFilters = req.AudienceFilters,
            MetricEvent = req.PrimaryMetricEvent,
            MetricType = req.PrimaryMetricType ?? "binary",
            MetricAgg = req.PrimaryMetricAgg ?? "once",
            ControlVariant = req.ControlVariant ?? "false",
            TreatmentVariant = req.TreatmentVariant ?? "true",
            Start = req.ObservationStart != null
                ? DateTimeOffset.Parse(req.ObservationStart)
                : now.AddDays(-30),
            End = req.ObservationEnd != null
                ? DateTimeOffset.Parse(req.ObservationEnd)
                : now,
        };

        // ── Step 1: Collect primary metric ──
        var summary = await collector.CollectAsync(p, ct);
        if (summary == null)
        {
            return Results.Json(new { error = "No data returned from TSDB" }, statusCode: 502);
        }

        var controlJson = JsonSerializer.SerializeToElement(summary.Control);
        var treatmentJson = JsonSerializer.SerializeToElement(summary.Treatment);
        var controlN = controlJson.TryGetProperty("n", out var cn) ? cn.GetInt64() : 0;
        var treatmentN = treatmentJson.TryGetProperty("n", out var tn) ? tn.GetInt64() : 0;
        if (controlN == 0 && treatmentN == 0)
        {
            return Results.Json(new { error = "No users collected yet", inputData = (object?)null }, statusCode: 200);
        }

        logger.LogInformation("[analyze] collected primary: {Type} control={CtrlN} treatment={TrtN}",
            summary.MetricType, controlN, treatmentN);

        // ── Step 2: Collect guardrail metrics ──
        var guardrailEventNames = new List<string>();
        if (!string.IsNullOrEmpty(req.GuardrailEvents))
        {
            try
            {
                var parsed = JsonSerializer.Deserialize<string[]>(req.GuardrailEvents);
                if (parsed != null) guardrailEventNames.AddRange(parsed);
            }
            catch { /* ignore malformed JSON */ }
        }

        var guardrailSummaries = new Dictionary<string, MetricSummary>();
        foreach (var gEvent in guardrailEventNames)
        {
            var gp = new ExperimentParams
            {
                Slug = p.Slug,
                ProjectId = p.ProjectId,
                EnvId = p.EnvId,
                FlagKey = p.FlagKey,
                Method = p.Method,
                ExperimentId = p.ExperimentId,
                LayerId = p.LayerId,
                TrafficPercent = p.TrafficPercent,
                TrafficOffset = p.TrafficOffset,
                AudienceFilters = p.AudienceFilters,
                MetricEvent = gEvent,
                MetricType = "binary",
                MetricAgg = "once",
                ControlVariant = p.ControlVariant,
                TreatmentVariant = p.TreatmentVariant,
                Start = p.Start,
                End = p.End,
            };
            var gs = await collector.CollectAsync(gp, ct);
            if (gs != null)
            {
                guardrailSummaries[gEvent] = gs;
            }
        }

        // ── Step 3: Build inputData (same shape as ExperimentWorker) ──
        var metricKey = req.PrimaryMetricEvent;
        var allMetrics = new Dictionary<string, object>
        {
            [metricKey] = new Dictionary<string, object>
            {
                [p.ControlVariant] = summary.Control,
                [p.TreatmentVariant] = summary.Treatment,
            }
        };
        foreach (var (gEvent, gs) in guardrailSummaries)
        {
            allMetrics[gEvent] = new Dictionary<string, object>
            {
                [p.ControlVariant] = gs.Control,
                [p.TreatmentVariant] = gs.Treatment,
            };
        }

        var inputData = new { metrics = allMetrics };
        var inputDataJson = JsonSerializer.Serialize(inputData, JsonOpts);

        // ── Step 4: Run Bayesian analysis ──
        var analysisInput = new PythonAnalysisInput
        {
            Slug = req.Slug ?? "on-demand",
            Metrics = allMetrics,
            Control = p.ControlVariant,
            Treatments = [p.TreatmentVariant],
            ObservationStart = req.ObservationStart,
            ObservationEnd = req.ObservationEnd,
            PriorProper = req.PriorProper ?? false,
            PriorMean = req.PriorMean ?? 0.0,
            PriorStddev = req.PriorStddev ?? 0.3,
            MinimumSample = req.MinimumSample ?? 0,
            GuardrailEvents = guardrailEventNames.Count > 0
                ? guardrailEventNames.ToArray() : null,
        };

        var result = await analyzer.AnalyzeAsync(analysisInput, ct);

        return Results.Json(new
        {
            inputData = inputDataJson,
            analysisResult = result?.GetRawText(),
        });
    }
}

// ── Request DTO ──────────────────────────────────────────────────────────────

public sealed class AnalyzeRequest
{
    [JsonPropertyName("slug")]
    public string? Slug { get; init; }

    [JsonPropertyName("projectId")]
    public string? ProjectId { get; init; }

    [JsonPropertyName("experimentId")]
    public string? ExperimentId { get; init; }

    [JsonPropertyName("envId")]
    public required string EnvId { get; init; }

    [JsonPropertyName("flagKey")]
    public required string FlagKey { get; init; }

    [JsonPropertyName("method")]
    public string? Method { get; init; }

    [JsonPropertyName("layerId")]
    public string? LayerId { get; init; }

    [JsonPropertyName("trafficPercent")]
    public double? TrafficPercent { get; init; }

    [JsonPropertyName("trafficOffset")]
    public int? TrafficOffset { get; init; }

    [JsonPropertyName("audienceFilters")]
    public string? AudienceFilters { get; init; }

    [JsonPropertyName("primaryMetricEvent")]
    public required string PrimaryMetricEvent { get; init; }

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

    [JsonPropertyName("guardrailEvents")]
    public string? GuardrailEvents { get; init; }
}
