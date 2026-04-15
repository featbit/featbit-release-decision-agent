using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;

namespace FeatBit.RollupService.Services;

/// <summary>
/// Background service that scans R2 for delta files every <see cref="IntervalMs"/> ms
/// and processes them concurrently.
/// </summary>
public sealed class RollupWorker(
    R2Client        r2,
    DeltaProcessor  processor,
    DbClient        db,
    IOptions<WorkerOptions> opts,
    ILogger<RollupWorker> log) : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken ct)
    {
        log.LogInformation("RollupWorker started. Interval={Interval}s", opts.Value.IntervalSeconds);

        while (!ct.IsCancellationRequested)
        {
            try
            {
                await RunCycleAsync(ct);
            }
            catch (OperationCanceledException) when (ct.IsCancellationRequested)
            {
                break;
            }
            catch (Exception ex)
            {
                log.LogError(ex, "Cycle failed");
            }

            await Task.Delay(TimeSpan.FromSeconds(opts.Value.IntervalSeconds), ct);
        }

        log.LogInformation("RollupWorker stopped.");
    }

    public async Task RunCycleAsync(CancellationToken ct)
    {
        // Query DB for running experiments; fail-open (empty = process all)
        var (allowedFe, allowedMe) = await db.GetRunningKeySegmentsAsync(ct);
        bool filterActive = allowedFe.Count > 0 || allowedMe.Count > 0;

        var deltaKeys = await r2.ListKeysAsync("deltas/", ct);
        if (deltaKeys.Count == 0)
        {
            log.LogDebug("No deltas found.");
            return;
        }

        if (filterActive)
        {
            deltaKeys = deltaKeys
                .Where(k => IsAllowed(k, allowedFe, allowedMe))
                .ToList();

            if (deltaKeys.Count == 0)
            {
                log.LogDebug("No deltas match running experiments.");
                return;
            }
        }

        log.LogInformation("Found {Count} delta(s) to process.", deltaKeys.Count);

        // Process in parallel with bounded concurrency
        var parallelOpts = new ParallelOptions
        {
            MaxDegreeOfParallelism = opts.Value.MaxConcurrency,
            CancellationToken      = ct,
        };

        await Parallel.ForEachAsync(deltaKeys, parallelOpts, async (key, innerCt) =>
        {
            try   { await processor.ProcessAsync(key, innerCt); }
            catch (Exception ex) { log.LogError(ex, "Failed to process {Key}", key); }
        });
    }

    /// <summary>
    /// Returns true if a delta key belongs to one of the allowed running experiments.
    ///
    /// Key format:  deltas/{flag-evals|metric-events}/{envId}/{key}/{date}/{ts}.json
    ///              parts: [0]deltas  [1]table  [2]envId  [3]key  [4]date  [5]ts.json
    /// </summary>
    private static bool IsAllowed(string key, HashSet<string> allowedFe, HashSet<string> allowedMe)
    {
        var parts = key.Split('/');
        if (parts.Length < 5) return false;
        var segment = $"{parts[2]}/{parts[3]}";
        return key.StartsWith("deltas/flag-evals/", StringComparison.Ordinal)
            ? allowedFe.Contains(segment)
            : allowedMe.Contains(segment);
    }
}

public class WorkerOptions
{
    public int IntervalSeconds { get; set; } = 600;   // 10 minutes
    public int MaxConcurrency  { get; set; } = 4;
}
