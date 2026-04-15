namespace FeatBit.TrackService.Services;

/// <summary>Configurable parameters for the in-memory queue + batch flush.</summary>
public sealed class IngestOptions
{
    /// <summary>Max events buffered in memory before producers block / drop.</summary>
    public int ChannelCapacity { get; set; } = 100_000;

    /// <summary>Flush as soon as this many events accumulate in the current batch.</summary>
    public int BatchSize { get; set; } = 1_000;

    /// <summary>Force-flush after this many milliseconds even if BatchSize not reached.</summary>
    public int FlushIntervalMs { get; set; } = 5_000;
}

public sealed class ClickHouseOptions
{
    /// <summary>
    /// Full ClickHouse.Client connection string, e.g.
    /// "Host=ch.example.com;Port=8443;Username=default;Password=...;Protocol=https;Database=featbit"
    /// </summary>
    public string ConnectionString { get; set; } = "";

    public string Database               { get; set; } = "featbit";
    public string FlagEvaluationsTable   { get; set; } = "flag_evaluations";
    public string MetricEventsTable      { get; set; } = "metric_events";
}
