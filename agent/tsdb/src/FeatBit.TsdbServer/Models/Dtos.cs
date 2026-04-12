using System.Text.Json.Serialization;

namespace FeatBit.TsdbServer.Models;

/// <summary>
/// Top-level payload sent by FeatBit SDK — one or more insight batches.
/// Identical to the TrackPayload in agent/data (shared SDK contract).
/// </summary>
public sealed class TrackPayload
{
    public EndUserDto User { get; set; } = default!;
    public IReadOnlyList<FlagEvalDto> Variations { get; set; } = [];
    public IReadOnlyList<MetricEventDto> Metrics { get; set; } = [];

    public bool IsValid() => User is { KeyId.Length: > 0 };
}

public sealed class EndUserDto
{
    public string KeyId { get; set; } = string.Empty;
    public string? Name { get; set; }
    public Dictionary<string, string>? Properties { get; set; }
}

public sealed class FlagEvalDto
{
    public string FlagKey { get; set; } = string.Empty;
    public string Variant { get; set; } = string.Empty;
    public bool SendToExperiment { get; set; }
    public string? ExperimentId { get; set; }
    public string? LayerId { get; set; }
    public long Timestamp { get; set; } // unix seconds
}

public sealed class MetricEventDto
{
    public string EventName { get; set; } = string.Empty;
    public double? NumericValue { get; set; }
    public string? Type { get; set; }
    public string? Route { get; set; }
    public string? AppType { get; set; }
    public long Timestamp { get; set; } // unix seconds
    public Dictionary<string, object>? Props { get; set; }
}

// ── Query request / response DTOs ─────────────────────────────────────────────

/// <summary>
/// HTTP request body for POST /api/query/experiment.
/// Mirrors ExperimentParams in agent/data for backward compatibility.
/// </summary>
public sealed class ExperimentQueryRequest
{
    public required string EnvId { get; init; }
    public required string FlagKey { get; init; }
    public required string MetricEvent { get; init; }
    public required string MetricType { get; init; }    // binary | revenue | count | duration
    public string MetricAgg { get; init; } = "once";     // once | sum | mean | count | latest
    public required string ControlVariant { get; init; }
    public required string TreatmentVariant { get; init; }
    public required DateTimeOffset Start { get; init; }
    public required DateTimeOffset End { get; init; }
    public string? ExperimentId { get; init; }
    public string? LayerId { get; init; }
    public int TrafficPercent { get; init; } = 100;
    public int TrafficOffset { get; init; } = 0;
    public string? AudienceFilters { get; init; }        // JSON: AudienceFilterEntry[]
    public string Method { get; init; } = "bayesian_ab";
}

/// <summary>
/// HTTP response body for POST /api/query/experiment.
/// Flat structure that maps variant names to per-variant statistics.
/// </summary>
public sealed class ExperimentQueryResponse
{
    [JsonPropertyName("metricType")]
    public required string MetricType { get; init; }

    [JsonPropertyName("variants")]
    public required Dictionary<string, VariantStatsDto> Variants { get; init; }
}

/// <summary>
/// Per-variant statistics. Binary metrics populate N and K; continuous metrics
/// populate N, Mean, Variance, and Total.
/// </summary>
public sealed class VariantStatsDto
{
    [JsonPropertyName("n")]
    public long N { get; init; }

    [JsonPropertyName("k")]
    public long? K { get; init; }           // binary only

    [JsonPropertyName("mean")]
    public double? Mean { get; init; }       // continuous only

    [JsonPropertyName("variance")]
    public double? Variance { get; init; }   // continuous only

    [JsonPropertyName("total")]
    public double? Total { get; init; }      // continuous only
}
