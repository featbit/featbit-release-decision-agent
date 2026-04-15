namespace FeatBit.TrackService.Models;

/// <summary>
/// One row destined for ClickHouse. We use a discriminated union via a tag
/// (TableKind) so a single Channel can carry both flag evaluations and metric
/// events; the batch worker fans them out into two INSERTs at flush time.
/// </summary>
public sealed class EventRecord
{
    public TableKind  Table        { get; init; }

    // Common
    public string     EnvId        { get; init; } = "";
    public string     UserKey      { get; init; } = "";
    public DateTime   Timestamp    { get; init; }
    public string     UserPropsJson { get; init; } = "{}";

    // Flag eval
    public string?    FlagKey      { get; init; }
    public string?    Variant      { get; init; }
    public string?    ExperimentId { get; init; }
    public string?    LayerId      { get; init; }
    public byte       HashBucket   { get; init; }

    // Metric event
    public string?    EventName    { get; init; }
    public double?    NumericValue { get; init; }
}

public enum TableKind
{
    FlagEvaluation = 0,
    MetricEvent    = 1,
}
