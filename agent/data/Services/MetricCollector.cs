using System.Net.Http.Json;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace FRD.DataServer.Services;

/// <summary>
/// Collects metric data for a single experiment by querying the tsdb service
/// (FeatBit.TsdbServer) via HTTP. Returns a MetricSummary ready for Python analysis.
/// </summary>
public sealed class MetricCollector
{
    private readonly HttpClient _http;
    private readonly ILogger<MetricCollector> _logger;

    private static readonly JsonSerializerOptions JsonOpts = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull,
    };

    public MetricCollector(IHttpClientFactory httpFactory, ILogger<MetricCollector> logger)
    {
        _http = httpFactory.CreateClient("TsdbClient");
        _logger = logger;
    }

    public async Task<MetricSummary?> CollectAsync(ExperimentParams p, CancellationToken ct)
    {
        try
        {
            var request = new TsdbQueryRequest
            {
                EnvId            = p.EnvId,
                FlagKey          = p.FlagKey,
                MetricEvent      = p.MetricEvent,
                MetricType       = p.MetricType,
                MetricAgg        = p.MetricAgg,
                ControlVariant   = p.ControlVariant,
                TreatmentVariant = p.TreatmentVariant,
                Start            = p.Start,
                End              = p.End,
                ExperimentId     = p.ExperimentId,
                LayerId          = p.LayerId,
                TrafficPercent   = (int)(p.TrafficPercent ?? 100),
                TrafficOffset    = p.TrafficOffset ?? 0,
                AudienceFilters  = p.AudienceFilters,
                Method           = p.Method,
            };

            using var httpReq = new HttpRequestMessage(HttpMethod.Post, "/api/query/experiment")
            {
                Content = JsonContent.Create(request, options: JsonOpts),
            };
            // tsdb auth: pass the envId as the Authorization header
            httpReq.Headers.TryAddWithoutValidation("Authorization", p.EnvId);

            using var resp = await _http.SendAsync(httpReq, ct);
            resp.EnsureSuccessStatusCode();

            var result = await resp.Content.ReadFromJsonAsync<TsdbQueryResponse>(JsonOpts, ct);
            if (result is null) return null;

            return MapToMetricSummary(result, p);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Failed to collect metrics for experiment {Slug}", p.Slug);
            return null;
        }
    }

    private static MetricSummary MapToMetricSummary(TsdbQueryResponse result, ExperimentParams p)
    {
        if (result.MetricType == "binary")
        {
            result.Variants.TryGetValue(p.ControlVariant, out var ctrl);
            result.Variants.TryGetValue(p.TreatmentVariant, out var trt);
            return new MetricSummary
            {
                MetricType = "binary",
                Control   = new BinaryVariant { N = ctrl?.N ?? 0, K = ctrl?.K ?? 0 },
                Treatment = new BinaryVariant { N = trt?.N  ?? 0, K = trt?.K  ?? 0 },
            };
        }
        else
        {
            result.Variants.TryGetValue(p.ControlVariant, out var ctrl);
            result.Variants.TryGetValue(p.TreatmentVariant, out var trt);
            return new MetricSummary
            {
                MetricType = result.MetricType,
                Control = new ContinuousVariant
                {
                    N        = ctrl?.N        ?? 0,
                    Mean     = ctrl?.Mean     ?? 0,
                    Variance = ctrl?.Variance ?? 0,
                    Total    = ctrl?.Total    ?? 0,
                },
                Treatment = new ContinuousVariant
                {
                    N        = trt?.N        ?? 0,
                    Mean     = trt?.Mean     ?? 0,
                    Variance = trt?.Variance ?? 0,
                    Total    = trt?.Total    ?? 0,
                },
            };
        }
    }
}

// ── Tsdb HTTP DTOs ────────────────────────────────────────────────────────────

internal sealed class TsdbQueryRequest
{
    public required string EnvId { get; init; }
    public required string FlagKey { get; init; }
    public required string MetricEvent { get; init; }
    public required string MetricType { get; init; }
    public string MetricAgg { get; init; } = "once";
    public required string ControlVariant { get; init; }
    public required string TreatmentVariant { get; init; }
    public required DateTimeOffset Start { get; init; }
    public required DateTimeOffset End { get; init; }
    public string? ExperimentId { get; init; }
    public string? LayerId { get; init; }
    public int TrafficPercent { get; init; } = 100;
    public int TrafficOffset { get; init; } = 0;
    public string? AudienceFilters { get; init; }
    public string Method { get; init; } = "bayesian_ab";
}

internal sealed class TsdbQueryResponse
{
    [JsonPropertyName("metricType")]
    public required string MetricType { get; init; }

    [JsonPropertyName("variants")]
    public required Dictionary<string, TsdbVariantStats> Variants { get; init; }
}

internal sealed class TsdbVariantStats
{
    [JsonPropertyName("n")]        public long    N        { get; init; }
    [JsonPropertyName("k")]        public long?   K        { get; init; }
    [JsonPropertyName("mean")]     public double? Mean     { get; init; }
    [JsonPropertyName("variance")] public double? Variance { get; init; }
    [JsonPropertyName("total")]    public double? Total    { get; init; }
}

// ── Filter model ─────────────────────────────────────────────────────────────

/// <summary>
/// One audience filter rule. Serialized as JSON in Experiment.audienceFilters.
/// e.g. {"property":"plan","op":"in","values":["premium","enterprise"]}
/// </summary>
public sealed class AudienceFilterEntry
{
    public string Property { get; set; } = "";
    public string Op { get; set; } = "eq";   // eq | neq | in | nin
    public string? Value { get; set; }        // for eq / neq
    public List<string>? Values { get; set; } // for in / nin
}

// ── Experiment params ─────────────────────────────────────────────────────────

public sealed class ExperimentParams
{
    public required string Slug { get; init; }
    public required string ProjectId { get; init; }
    public required string EnvId { get; init; }
    public required string FlagKey { get; init; }
    public required string Method { get; init; }        // bayesian_ab | bandit
    public string? ExperimentId { get; init; }           // matches flag_evaluations.experiment_id; null = no filter
    public string? LayerId { get; init; }                // mutual-exclusion layer
    public double? TrafficPercent { get; init; }         // 0–100; null = 100 (all users)
    public int? TrafficOffset { get; init; }              // 0–99; null = 0 (bucket starts at 0)
    public string? AudienceFilters { get; init; }        // JSON: AudienceFilterEntry[]
    public required string MetricEvent { get; init; }
    public required string MetricType { get; init; }     // binary | revenue | count | duration
    public required string MetricAgg { get; init; }      // once | sum | mean | count | latest
    public required string ControlVariant { get; init; }
    public required string TreatmentVariant { get; init; }
    public required DateTimeOffset Start { get; init; }
    public required DateTimeOffset End { get; init; }
}

// ── Metric summary models ─────────────────────────────────────────────────────

/// <summary>Metric summary — fed to Python analyzer via stdin.</summary>
public sealed class MetricSummary
{
    [JsonPropertyName("metricType")]
    public required string MetricType { get; init; }

    [JsonPropertyName("control")]
    public required object Control { get; init; }

    [JsonPropertyName("treatment")]
    public required object Treatment { get; init; }
}

public sealed class BinaryVariant
{
    [JsonPropertyName("n")] public long N { get; init; }
    [JsonPropertyName("k")] public long K { get; init; }
}

public sealed class ContinuousVariant
{
    [JsonPropertyName("n")]        public long   N        { get; init; }
    [JsonPropertyName("mean")]     public double Mean     { get; init; }
    [JsonPropertyName("variance")] public double Variance { get; init; }
    [JsonPropertyName("total")]    public double Total    { get; init; }
}

