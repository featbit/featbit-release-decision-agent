using FeatBit.TrackService.Models;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;

namespace FeatBit.TrackService.Services;

/// <summary>
/// Single-reader background loop that drains the EventQueue in batches and
/// flushes them to ClickHouse. Flushes when either:
///   - <see cref="IngestOptions.BatchSize"/> events are accumulated, or
///   - <see cref="IngestOptions.FlushIntervalMs"/> has elapsed since the last flush.
///
/// Flag evals and metric events share the same channel for back-pressure
/// fairness, then get split into two INSERTs at flush time so each table sees
/// a clean bulk write.
/// </summary>
public sealed class BatchIngestWorker(
    EventQueue queue,
    ClickHouseIngestClient ch,
    IOptions<IngestOptions> opts,
    ILogger<BatchIngestWorker> log) : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken ct)
    {
        var batchSize = opts.Value.BatchSize;
        var flushMs   = opts.Value.FlushIntervalMs;
        log.LogInformation("BatchIngestWorker started. batchSize={Batch} flushMs={Flush}", batchSize, flushMs);

        var feBuf = new List<EventRecord>(capacity: batchSize);
        var meBuf = new List<EventRecord>(capacity: batchSize);

        while (!ct.IsCancellationRequested)
        {
            try
            {
                await FillBatchAsync(feBuf, meBuf, batchSize, flushMs, ct);
                if (feBuf.Count + meBuf.Count == 0) continue;

                var sw = System.Diagnostics.Stopwatch.StartNew();
                int feCount = feBuf.Count, meCount = meBuf.Count;
                try
                {
                    var t1 = ch.InsertFlagEvaluationsAsync(feBuf, ct);
                    var t2 = ch.InsertMetricEventsAsync(meBuf, ct);
                    await Task.WhenAll(t1, t2);
                    log.LogInformation(
                        "Flushed fe={Fe} me={Me} elapsed={Ms}ms",
                        feCount, meCount, sw.ElapsedMilliseconds);
                }
                catch (Exception ex)
                {
                    log.LogError(ex,
                        "ClickHouse flush failed (fe={Fe} me={Me}); events dropped after {Ms}ms",
                        feCount, meCount, sw.ElapsedMilliseconds);
                    // Intentional: don't re-enqueue. If you need at-least-once
                    // semantics, swap the in-memory channel for a persistent
                    // queue (Event Hub, durable WAL, etc.).
                }
                finally
                {
                    feBuf.Clear();
                    meBuf.Clear();
                }
            }
            catch (OperationCanceledException) when (ct.IsCancellationRequested)
            {
                break;
            }
            catch (Exception ex)
            {
                log.LogError(ex, "BatchIngestWorker loop error");
            }
        }

        log.LogInformation("BatchIngestWorker stopped.");
    }

    /// <summary>
    /// Pull events out of the channel until we hit batchSize total, OR until
    /// flushIntervalMs has elapsed since we started filling, OR until the channel closes.
    /// </summary>
    private async Task FillBatchAsync(
        List<EventRecord> feBuf,
        List<EventRecord> meBuf,
        int batchSize,
        int flushIntervalMs,
        CancellationToken ct)
    {
        var deadline   = DateTime.UtcNow.AddMilliseconds(flushIntervalMs);
        var reader     = queue.Channel.Reader;

        while (DateTime.UtcNow < deadline && feBuf.Count + meBuf.Count < batchSize)
        {
            var remaining = deadline - DateTime.UtcNow;
            if (remaining <= TimeSpan.Zero) break;

            using var timeout = new CancellationTokenSource(remaining);
            using var linked  = CancellationTokenSource.CreateLinkedTokenSource(ct, timeout.Token);

            try
            {
                if (!await reader.WaitToReadAsync(linked.Token)) return; // channel closed
                while (reader.TryRead(out var rec))
                {
                    if (rec.Table == TableKind.FlagEvaluation) feBuf.Add(rec);
                    else                                       meBuf.Add(rec);
                    if (feBuf.Count + meBuf.Count >= batchSize) return;
                }
            }
            catch (OperationCanceledException) when (timeout.IsCancellationRequested && !ct.IsCancellationRequested)
            {
                return; // flush deadline hit
            }
        }
    }
}
