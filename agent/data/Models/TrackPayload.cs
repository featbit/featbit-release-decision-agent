using System.Text.Json.Serialization;

namespace FRD.DataServer.Models;

/// <summary>
/// Top-level payload sent by SDK — one or more insight batches.
/// POST /api/track accepts ICollection&lt;TrackPayload&gt;.
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
    /// <summary>
    /// Arbitrary key-value attributes for audience filtering and CUPED covariate analysis.
    /// e.g. { "plan": "premium", "region": "US", "device": "mobile" }
    /// </summary>
    public Dictionary<string, string>? Properties { get; set; }
}

/// <summary>
/// A flag evaluation insight — mirrors the SDK's VariationInsight.
/// </summary>
public sealed class FlagEvalDto
{
    public string FlagKey { get; set; } = string.Empty;
    public string Variant { get; set; } = string.Empty;
    public bool SendToExperiment { get; set; }
    public string? ExperimentId { get; set; }
    public string? LayerId { get; set; }
    public long Timestamp { get; set; } // unix seconds
}

/// <summary>
/// A custom metric event — mirrors the SDK's MetricInsight.
/// </summary>
public sealed class MetricEventDto
{
    public string EventName { get; set; } = string.Empty;
    public double? NumericValue { get; set; }
    public string? Type { get; set; }        // event type / category
    public string? Route { get; set; }
    public string? AppType { get; set; }     // Web, Mobile, etc.
    public long Timestamp { get; set; }      // unix seconds
    public Dictionary<string, object>? Props { get; set; }
}
