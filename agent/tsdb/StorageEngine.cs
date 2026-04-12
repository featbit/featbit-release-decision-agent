using System.Collections.Concurrent;
using FRD.Tsdb.Models;
using FRD.Tsdb.Query;
using FRD.Tsdb.Storage;

namespace FRD.Tsdb;

/// <summary>
/// Top-level facade for writing events to the columnar on-disk store.
///
/// Directory layout:
///   {dataRoot}/
///     flag-evals/
///       {env_id}/{flag_key}/{yyyy-MM-dd}/
///         seg-00000001.fbs
///         seg-00000002.fbs
///     metric-events/
///       {env_id}/{event_name}/{yyyy-MM-dd}/
///         seg-00000001.fbs
///
/// One <see cref="PartitionWriter{T}"/> is created per (table, env_id, key, date) combination
/// and cached in a <see cref="ConcurrentDictionary{TKey,TValue}"/>.
/// Writers for stale partitions (past dates) are evicted periodically.
///
/// Thread-safety: all public methods are safe to call concurrently.
/// </summary>
public sealed partial class StorageEngine : IAsyncDisposable
{
    private readonly string   _dataRoot;
    private readonly int      _maxBatchSize;
    private readonly TimeSpan _flushInterval;

    private readonly ConcurrentDictionary<string, PartitionWriter<FlagEvalRecord>>
        _flagEvalWriters = new();

    private readonly ConcurrentDictionary<string, PartitionWriter<MetricEventRecord>>
        _metricEventWriters = new();

    // ── Construction ──────────────────────────────────────────────────────────

    /// <param name="dataRoot">Root directory for all segment files.</param>
    /// <param name="maxBatchSize">
    ///   Flush a segment when this many records accumulate.
    ///   Default 10 000. At 50 k events/s, a 500 ms flush interval produces ~25 k rows/segment.
    /// </param>
    /// <param name="flushInterval">
    ///   Maximum time between flushes even when the batch is not full.
    ///   Default 500 ms — keeps data visible to queries within half a second.
    /// </param>
    public StorageEngine(
        string dataRoot,
        int maxBatchSize      = 10_000,
        TimeSpan? flushInterval = null)
    {
        _dataRoot      = dataRoot;
        _maxBatchSize  = maxBatchSize;
        _flushInterval = flushInterval ?? TimeSpan.FromMilliseconds(500);

        Directory.CreateDirectory(dataRoot);
    }

    // ── Write API ─────────────────────────────────────────────────────────────

    /// <summary>
    /// Enqueue a flag evaluation event.  Returns almost immediately — actual disk
    /// write happens on the background flush task.
    /// </summary>
    public ValueTask WriteFlagEvalAsync(FlagEvalRecord record, CancellationToken ct = default)
    {
        var writer = GetOrCreateFlagEvalWriter(record.EnvId, record.FlagKey, record.Timestamp);
        return writer.WriteAsync(record, ct);
    }

    /// <summary>
    /// Enqueue a metric / conversion event.
    /// </summary>
    public ValueTask WriteMetricEventAsync(MetricEventRecord record, CancellationToken ct = default)
    {
        var writer = GetOrCreateMetricEventWriter(record.EnvId, record.EventName, record.Timestamp);
        return writer.WriteAsync(record, ct);
    }

    // ── Shutdown ──────────────────────────────────────────────────────────────

    public async ValueTask DisposeAsync()
    {
        // Flush all partition writers in parallel.
        var disposes = new List<ValueTask>();

        foreach (var w in _flagEvalWriters.Values)   disposes.Add(w.DisposeAsync());
        foreach (var w in _metricEventWriters.Values) disposes.Add(w.DisposeAsync());

        foreach (var d in disposes) await d;
    }

    // ── Internals ─────────────────────────────────────────────────────────────

    /// <summary>
    /// Create a query engine backed by the same data directory.
    /// Use this to run experiment metric queries (replaces MetricCollector).
    /// </summary>
    public ExperimentQueryEngine CreateQueryEngine() => new(_dataRoot);

    private PartitionWriter<FlagEvalRecord> GetOrCreateFlagEvalWriter(
        string envId, string flagKey, long timestampMs)
    {
        var date = ToDateString(timestampMs);
        var dir  = PathHelper.FlagEvalPartitionDir(_dataRoot, envId, flagKey, date);
        var key  = dir;

        return _flagEvalWriters.GetOrAdd(key, _ =>
        {
            var writer = new PartitionWriter<FlagEvalRecord>(
                dir,
                (batch, path, ct) => FlagEvalSegmentWriter.WriteAsync(batch, path, ct),
                _maxBatchSize,
                _flushInterval);
            writer.Start();
            return writer;
        });
    }

    private PartitionWriter<MetricEventRecord> GetOrCreateMetricEventWriter(
        string envId, string eventName, long timestampMs)
    {
        var date = ToDateString(timestampMs);
        var dir  = PathHelper.MetricEventPartitionDir(_dataRoot, envId, eventName, date);
        var key  = dir;

        return _metricEventWriters.GetOrAdd(key, _ =>
        {
            var writer = new PartitionWriter<MetricEventRecord>(
                dir,
                (batch, path, ct) => MetricEventSegmentWriter.WriteAsync(batch, path, ct),
                _maxBatchSize,
                _flushInterval);
            writer.Start();
            return writer;
        });
    }

    private static string ToDateString(long unixMs)
        => DateTimeOffset.FromUnixTimeMilliseconds(unixMs).UtcDateTime.ToString("yyyy-MM-dd");
}
