namespace FRD.DataServer.Models;

/// <summary>
/// Internal message for a flag evaluation row — written to PG flag_evaluations table.
/// </summary>
public sealed class FlagEvalMessage
{
    public required string EnvId { get; init; }
    public required string FlagKey { get; init; }
    public required string UserKey { get; init; }
    public required string Variant { get; init; }
    public string? ExperimentId { get; init; }
    public string? LayerId { get; init; }
    public DateTimeOffset EvaluatedAt { get; init; }
    /// <summary>User properties snapshot at evaluation time — stored as JSONB for audience queries.</summary>
    public Dictionary<string, string>? UserProps { get; init; }
}

/// <summary>
/// Internal message for a metric event row — written to PG metric_events table.
/// </summary>
public sealed class MetricEventMessage
{
    public required string EnvId { get; init; }
    public required string EventName { get; init; }
    public required string UserKey { get; init; }
    public double? NumericValue { get; init; }
    public DateTimeOffset OccurredAt { get; init; }
    public string? Source { get; init; }
    public string? Route { get; init; }
    public string? AppType { get; init; }
    public string? Props { get; init; } // JSON string
}
