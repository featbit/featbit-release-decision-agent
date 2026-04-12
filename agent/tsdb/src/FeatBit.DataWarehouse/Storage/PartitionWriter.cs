using System.Threading.Channels;

namespace FeatBit.DataWarehouse.Storage;

/// <summary>
/// Buffers incoming records in a <see cref="Channel{T}"/> and flushes them as
/// immutable segment files on a background task.
///
/// Flush is triggered by whichever comes first:
///   • Batch size reaches <see cref="MaxBatchSize"/> (back-pressure threshold).
///   • <see cref="FlushInterval"/> elapses since the last flush (latency bound).
///
/// Thread-safety: <see cref="WriteAsync"/> is safe to call from many threads
/// concurrently. The background flush task is the only writer to disk.
/// </summary>
internal sealed class PartitionWriter<T>(
    string partitionDir,
    Func<IReadOnlyList<T>, string, CancellationToken, Task> writeSegment,
    int maxBatchSize = 10_000,
    TimeSpan? flushInterval = null) : IAsyncDisposable
{
    // Expose for tuning / testing
    public int      MaxBatchSize   { get; } = maxBatchSize;
    public TimeSpan FlushInterval  { get; } = flushInterval ?? TimeSpan.FromMilliseconds(500);

    private readonly Channel<T> _channel = Channel.CreateBounded<T>(new BoundedChannelOptions(maxBatchSize * 2)
    {
        FullMode     = BoundedChannelFullMode.Wait,
        SingleReader = true,   // only the background task reads
        SingleWriter = false,  // many HTTP threads write
    });

    private long _segmentCounter = ScanMaxSegment(partitionDir);

    private readonly CancellationTokenSource _cts   = new();
    private readonly Task                    _bgTask = Task.CompletedTask; // replaced below

    // C# 10+ primary-constructor style doesn't allow instance member init that references other members,
    // so we run background task via a factory method instead.
    private Task? _runTask;
    private int   _disposed;

    // Call after construction to start the background loop.
    internal void Start() =>
        _runTask = Task.Run(() => RunAsync(_cts.Token));

    // ── Write API ─────────────────────────────────────────────────────────────

    /// <summary>
    /// Enqueue a record. Awaits only if the channel is full (back-pressure).
    /// Under normal load this returns synchronously.
    /// </summary>
    public ValueTask WriteAsync(T item, CancellationToken ct = default)
        => _channel.Writer.WriteAsync(item, ct);

    // ── Background flush loop ─────────────────────────────────────────────────

    private async Task RunAsync(CancellationToken ct)
    {
        var batch = new List<T>(MaxBatchSize);
        using var timer     = new PeriodicTimer(FlushInterval);
        var       timerTask = timer.WaitForNextTickAsync(ct).AsTask();

        try
        {
            while (!ct.IsCancellationRequested)
            {
                // Drain as many items as possible without blocking.
                while (batch.Count < MaxBatchSize && _channel.Reader.TryRead(out var item))
                    batch.Add(item);

                if (batch.Count >= MaxBatchSize)
                {
                    await FlushBatchAsync(batch, ct);
                    batch.Clear();
                    continue;
                }

                // Wait for either more items or the flush timer.
                var readyTask = _channel.Reader.WaitToReadAsync(ct).AsTask();
                var completed = await Task.WhenAny(readyTask, timerTask);

                if (completed == timerTask)
                {
                    if (batch.Count > 0)
                    {
                        await FlushBatchAsync(batch, ct);
                        batch.Clear();
                    }
                    // Reset timer regardless of whether we flushed.
                    timerTask = timer.WaitForNextTickAsync(ct).AsTask();
                }
                // else: items ready — loop back to drain
            }
        }
        catch (OperationCanceledException) { /* shutdown */ }

        // ── Graceful drain on shutdown ────────────────────────────────────────
        _channel.Writer.TryComplete();
        await foreach (var item in _channel.Reader.ReadAllAsync(CancellationToken.None))
            batch.Add(item);

        if (batch.Count > 0)
            await FlushBatchAsync(batch, CancellationToken.None);
    }

    private async Task FlushBatchAsync(List<T> batch, CancellationToken ct)
    {
        long seq      = Interlocked.Increment(ref _segmentCounter);
        var  dir      = partitionDir;
        Directory.CreateDirectory(dir);

        var filePath = Path.Combine(dir, $"seg-{seq:D8}{SegmentConstants.FileExtension}");
        await writeSegment(batch, filePath, ct);
    }

    // ── Shutdown ──────────────────────────────────────────────────────────────

    public async ValueTask DisposeAsync()
    {
        if (Interlocked.Exchange(ref _disposed, 1) != 0) return; // idempotent
        _cts.Cancel();
        if (_runTask is not null)
            await _runTask.ConfigureAwait(false);
        _cts.Dispose();
    }

    // ── Helpers ───────────────────────────────────────────────────────────────

    /// <summary>
    /// Scan the partition directory for existing segment files so the counter
    /// resumes from the correct sequence number after a restart.
    /// </summary>
    private static long ScanMaxSegment(string dir)
    {
        if (!Directory.Exists(dir)) return 0L;

        long max = 0L;
        foreach (var path in Directory.EnumerateFiles(dir, $"*{SegmentConstants.FileExtension}"))
        {
            var name = Path.GetFileNameWithoutExtension(path);
            if (name.StartsWith("seg-", StringComparison.Ordinal)
                && long.TryParse(name.AsSpan(4), out var n))
            {
                if (n > max) max = n;
            }
        }

        return max;
    }
}
