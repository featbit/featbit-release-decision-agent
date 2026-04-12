namespace FeatBit.DataWarehouse.Models;

/// <summary>
/// One custom metric event (conversion record).
/// Mirrors MetricEventMessage from the DataServer project.
/// Stored in the metric-events columnar store, partitioned by (env_id, event_name, date).
///
/// At query time, metric events are joined to flag_eval records via UserKey to compute
/// per-variant aggregates: binary {n, k} or continuous {n, mean, variance}.
/// </summary>
public sealed class MetricEventRecord
{
    public required string EnvId { get; init; }

    /// <summary>The metric / event name. Corresponds to event_name in metric_events table.</summary>
    public required string EventName { get; init; }

    /// <summary>The end-user key. Join key with FlagEvalRecord.UserKey.</summary>
    public required string UserKey { get; init; }

    /// <summary>
    /// Optional numeric payload.
    /// - null or 1/0  → binary (conversion / no-conversion)
    /// - any double   → continuous (revenue, duration, score …)
    /// Corresponds to numeric_value in metric_events table.
    /// </summary>
    public double? NumericValue { get; init; }

    /// <summary>Unix milliseconds. Corresponds to OccurredAt in MetricEventMessage.</summary>
    public required long Timestamp { get; init; }

    public string? SessionId { get; init; }

    /// <summary>AppType / source (Web, Mobile, etc.). Corresponds to Source / AppType in MetricEventMessage.</summary>
    public string? Source { get; init; }

    public static MetricEventRecord Create(
        string envId,
        string eventName,
        string userKey,
        long timestampMs,
        double? numericValue = null,
        string? sessionId = null,
        string? source = null) => new()
    {
        EnvId = envId,
        EventName = eventName,
        UserKey = userKey,
        Timestamp = timestampMs,
        NumericValue = numericValue,
        SessionId = sessionId,
        Source = source,
    };
}
