using System.Collections.Concurrent;
using FeatBit.DataWarehouse.Models;
using FeatBit.DataWarehouse.Query;
using FeatBit.DataWarehouse.Storage;

namespace FeatBit.DataWarehouse;

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
/// Writers for stale partitions (past dates) are evicted periodically by a background task.
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

    // Observed peak batch sizes per partition key — used to right-size the initial List<T>
    // capacity when a writer is recreated after eviction. Shared across both table types
    // (keys are full directory paths, so they cannot collide).
    private readonly ConcurrentDictionary<string, int> _observedCapacities = new();

    // ── Eviction ──────────────────────────────────────────────────────────────

    // How often to scan for stale writers.
    // Default: every 15 minutes.
    private readonly TimeSpan _evictionInterval;

    // How long a writer can be idle before it is evicted, even if its partition date is today.
    // Default: 2 hours. Set to TimeSpan.MaxValue to disable idle eviction.
    private readonly TimeSpan _idleTimeout;

    private readonly CancellationTokenSource _evictionCts = new();
    private readonly Task _evictionTask;

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
    /// <param name="evictionInterval">
    ///   How often to evict writers for past-date partitions.
    ///   Default 15 minutes. Each stale writer holds ~82 KB; eviction keeps memory bounded.
    /// </param>
    /// <param name="idleTimeout">
    ///   How long a writer can be idle before eviction, even if its partition date is today.
    ///   Default 30 minutes — reclaims memory promptly when flag traffic drops off.
    ///   Set to <see cref="TimeSpan.MaxValue"/> to disable idle eviction.
    /// </param>
    public StorageEngine(
        string dataRoot,
        int maxBatchSize           = 10_000,
        TimeSpan? flushInterval    = null,
        TimeSpan? evictionInterval = null,
        TimeSpan? idleTimeout      = null)
    {
        _dataRoot         = dataRoot;
        _maxBatchSize     = maxBatchSize;
        _flushInterval    = flushInterval    ?? TimeSpan.FromMilliseconds(500);
        _evictionInterval = evictionInterval ?? TimeSpan.FromMinutes(15);
        _idleTimeout      = idleTimeout      ?? TimeSpan.FromMinutes(30);

        Directory.CreateDirectory(dataRoot);

        _evictionTask = Task.Run(() => EvictStaleWritersAsync(_evictionCts.Token));
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
        // Stop eviction loop first.
        await _evictionCts.CancelAsync();
        try { await _evictionTask; } catch (OperationCanceledException) { }
        _evictionCts.Dispose();

        // Flush all remaining partition writers in parallel.
        var disposes = new List<ValueTask>();

        foreach (var w in _flagEvalWriters.Values)   disposes.Add(w.DisposeAsync());
        foreach (var w in _metricEventWriters.Values) disposes.Add(w.DisposeAsync());

        foreach (var d in disposes) await d;
    }

    // ── Stale-writer eviction ─────────────────────────────────────────────────

    /// <summary>
    /// Background loop: every <see cref="_evictionInterval"/>, dispose and remove
    /// writers whose partition date is strictly before today (UTC).
    ///
    /// Each stale writer holds ~82 KB (pre-allocated batch list + channel + task overhead).
    /// Without eviction, a system with 100 envs × 2 000 flags accumulates ~16 GB per day.
    /// </summary>
    private async Task EvictStaleWritersAsync(CancellationToken ct)
    {
        using var timer = new PeriodicTimer(_evictionInterval);

        while (await timer.WaitForNextTickAsync(ct))
        {
            var today = DateOnly.FromDateTime(DateTime.UtcNow);
            await EvictDictionaryAsync(_flagEvalWriters, today, _idleTimeout, _observedCapacities);
            await EvictDictionaryAsync(_metricEventWriters, today, _idleTimeout, _observedCapacities);
        }
    }

    private static async Task EvictDictionaryAsync<T>(
        ConcurrentDictionary<string, PartitionWriter<T>> dict,
        DateOnly today,
        TimeSpan idleTimeout,
        ConcurrentDictionary<string, int> capacityHints)
    {
        var idleCutoff = DateTime.UtcNow - idleTimeout;

        foreach (var key in dict.Keys)
        {
            // Partition key is the full directory path; the last segment is yyyy-MM-dd.
            var datePart = Path.GetFileName(key.AsSpan());
            if (!DateOnly.TryParseExact(datePart, "yyyy-MM-dd", null, System.Globalization.DateTimeStyles.None, out var date))
                continue;

            bool staleDate = date < today;
            // dict[key] is safe here: we iterate Keys and the writer only disappears via TryRemove below.
            bool idle = dict.TryGetValue(key, out var w)
                        && new DateTime(w.LastWriteAt, DateTimeKind.Utc) < idleCutoff;

            if (staleDate || idle)
            {
                // TryRemove is atomic: only one thread disposes each writer.
                if (dict.TryRemove(key, out var writer))
                {
                    // Save observed peak so the next writer for this partition starts
                    // with an appropriately sized batch list instead of always 10 000.
                    capacityHints[key] = Math.Max(16, writer.PeakBatchSeen);
                    await writer.DisposeAsync();
                }
            }
        }
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
            int initialCapacity = _observedCapacities.GetValueOrDefault(key, 256);
            var writer = new PartitionWriter<FlagEvalRecord>(
                dir,
                (batch, path, ct) => FlagEvalSegmentWriter.WriteAsync(batch, path, ct),
                _maxBatchSize,
                _flushInterval,
                initialCapacity);
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
            int initialCapacity = _observedCapacities.GetValueOrDefault(key, 256);
            var writer = new PartitionWriter<MetricEventRecord>(
                dir,
                (batch, path, ct) => MetricEventSegmentWriter.WriteAsync(batch, path, ct),
                _maxBatchSize,
                _flushInterval,
                initialCapacity);
            writer.Start();
            return writer;
        });
    }

    private static string ToDateString(long unixMs)
        => DateTimeOffset.FromUnixTimeMilliseconds(unixMs).UtcDateTime.ToString("yyyy-MM-dd");
}
