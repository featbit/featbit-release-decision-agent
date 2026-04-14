using System.Buffers;
using System.Text.Json;
using FeatBit.RollupService.Models;
using Microsoft.Extensions.Logging;

namespace FeatBit.RollupService.Services;

/// <summary>
/// Reads a single delta file from R2, merges it into the corresponding rollup,
/// writes the rollup back, then deletes the delta.
///
/// Delta path  : deltas/{flag-evals|metric-events}/{envId}/{key}/{date}/{ts}.json
/// Rollup path : rollups/{flag-evals|metric-events}/{envId}/{key}/{date}.json
/// </summary>
public sealed class DeltaProcessor(R2Client r2, ILogger<DeltaProcessor> log)
{
    private static readonly JsonSerializerOptions JsonOpts = new()
    {
        PropertyNameCaseInsensitive = true,
    };

    // ── Public entry point ────────────────────────────────────────────────────

    public async Task ProcessAsync(string deltaKey, CancellationToken ct)
    {
        var isFlagEval = deltaKey.StartsWith("deltas/flag-evals/");
        var rollupKey  = DeltaKeyToRollupKey(deltaKey, isFlagEval);
        var sw         = System.Diagnostics.Stopwatch.StartNew();

        // Step 1 — download delta
        var t0        = sw.ElapsedMilliseconds;
        var deltaJson = await r2.GetStringAsync(deltaKey, ct);
        if (deltaJson is null) { log.LogWarning("Delta not found: {Key}", deltaKey); return; }
        var deltaBytes = System.Text.Encoding.UTF8.GetByteCount(deltaJson);
        log.LogInformation("[{Key}] GET delta {Bytes:N0}B → {Ms}ms",
            System.IO.Path.GetFileName(deltaKey), deltaBytes, sw.ElapsedMilliseconds - t0);

        var delta = JsonSerializer.Deserialize<DeltaFile>(deltaJson, JsonOpts);
        if (delta is null || delta.U.Count == 0) { await r2.DeleteAsync(deltaKey, ct); return; }
        log.LogInformation("[{Key}] {Users} users in delta", System.IO.Path.GetFileName(deltaKey), delta.U.Count);

        // Step 2 — merge + upload
        t0 = sw.ElapsedMilliseconds;
        if (isFlagEval)
            await MergeFlagEvalAsync(rollupKey, delta, ct, sw);
        else
            await MergeMetricEventAsync(rollupKey, delta, ct, sw);

        // Step 3 — delete delta
        t0 = sw.ElapsedMilliseconds;
        await r2.DeleteAsync(deltaKey, ct);
        log.LogInformation("[{Key}] DELETE delta → {Ms}ms  |  total {Total}ms",
            System.IO.Path.GetFileName(deltaKey), sw.ElapsedMilliseconds - t0, sw.ElapsedMilliseconds);
    }

    // ── Flag-eval merge ───────────────────────────────────────────────────────

    private async Task MergeFlagEvalAsync(string rollupKey, DeltaFile delta, CancellationToken ct,
        System.Diagnostics.Stopwatch sw)
    {
        var t0         = sw.ElapsedMilliseconds;
        var rollupJson = await r2.GetStringAsync(rollupKey, ct);
        var rollupBytes = rollupJson is not null ? System.Text.Encoding.UTF8.GetByteCount(rollupJson) : 0;
        log.LogInformation("  GET existing rollup {Bytes:N0}B → {Ms}ms",
            rollupBytes, sw.ElapsedMilliseconds - t0);

        var rollup = rollupJson is not null
            ? JsonSerializer.Deserialize<FlagEvalRollup>(rollupJson, JsonOpts) ?? new()
            : new FlagEvalRollup();

        // Merge: keep entry with min timestamp
        t0 = sw.ElapsedMilliseconds;
        foreach (var (userKey, entry) in delta.U)
        {
            if (!rollup.U.TryGetValue(userKey, out var existing))
            {
                rollup.U[userKey] = entry;
            }
            else
            {
                var existingTs = existing.EnumerateArray().First().GetInt64();
                var newTs      = entry.EnumerateArray().First().GetInt64();
                if (newTs < existingTs) rollup.U[userKey] = entry;
            }
        }
        log.LogInformation("  merge {Users} → {Ms}ms", rollup.U.Count, sw.ElapsedMilliseconds - t0);

        t0 = sw.ElapsedMilliseconds;
        var serialized = SerializeRollup(rollup);
        await r2.PutStringAsync(rollupKey, serialized, ct);
        log.LogInformation("  PUT rollup {Bytes:N0}B → {Ms}ms",
            System.Text.Encoding.UTF8.GetByteCount(serialized), sw.ElapsedMilliseconds - t0);
    }

    // ── Metric-event merge ────────────────────────────────────────────────────

    private async Task MergeMetricEventAsync(string rollupKey, DeltaFile delta, CancellationToken ct,
        System.Diagnostics.Stopwatch sw)
    {
        var t0         = sw.ElapsedMilliseconds;
        var rollupJson = await r2.GetStringAsync(rollupKey, ct);
        var rollupBytes = rollupJson is not null ? System.Text.Encoding.UTF8.GetByteCount(rollupJson) : 0;
        log.LogInformation("  GET existing rollup {Bytes:N0}B → {Ms}ms",
            rollupBytes, sw.ElapsedMilliseconds - t0);
        var rollup     = rollupJson is not null
            ? JsonSerializer.Deserialize<MetricEventRollup>(rollupJson, JsonOpts) ?? new()
            : new MetricEventRollup();

        // Convert existing entries to mutable accumulators
        t0 = sw.ElapsedMilliseconds;
        var accMap = new Dictionary<string, MetricAcc>(rollup.U.Count);
        foreach (var (uk, e) in rollup.U)
            accMap[uk] = MetricAcc.FromJsonElement(e);

        // Merge delta
        foreach (var (uk, e) in delta.U)
        {
            var incoming = MetricAcc.FromJsonElement(e);
            if (!accMap.TryGetValue(uk, out var existing))
                accMap[uk] = incoming;
            else
                existing.Merge(incoming);
        }
        log.LogInformation("  merge {Users} → {Ms}ms", accMap.Count, sw.ElapsedMilliseconds - t0);

        // Serialize back
        t0 = sw.ElapsedMilliseconds;
        using var ms  = new MemoryStream();
        using var w   = new Utf8JsonWriter(ms);
        w.WriteStartObject();
        w.WriteNumber("v", 1);
        w.WritePropertyName("u");
        w.WriteStartObject();
        foreach (var (uk, acc) in accMap)
        {
            w.WritePropertyName(uk);
            acc.WriteTo(w);
        }
        w.WriteEndObject();
        w.WriteEndObject();
        w.Flush();

        var json = System.Text.Encoding.UTF8.GetString(ms.ToArray());
        await r2.PutStringAsync(rollupKey, json, ct);
        log.LogInformation("  PUT rollup {Bytes:N0}B → {Ms}ms",
            System.Text.Encoding.UTF8.GetByteCount(json), sw.ElapsedMilliseconds - t0);
    }

    // ── Helpers ───────────────────────────────────────────────────────────────

    /// <summary>
    /// Convert delta key to rollup key.
    /// deltas/flag-evals/{envId}/{flagKey}/{date}/{ts}.json
    ///   → rollups/flag-evals/{envId}/{flagKey}/{date}.json
    /// </summary>
    private static string DeltaKeyToRollupKey(string deltaKey, bool isFlagEval)
    {
        // Strip "deltas/" prefix → "flag-evals/{envId}/{key}/{date}/{ts}.json"
        var inner = deltaKey["deltas/".Length..];

        // Split into parts: [table, envId, key, date, filename]
        var parts = inner.Split('/');
        // parts: [0]=table, [1]=envId, [2]=key, [3]=date, [4]=ts.json

        // Reconstruct rollup path (date without ts)
        return $"rollups/{parts[0]}/{parts[1]}/{parts[2]}/{parts[3]}.json";
    }

    private static string SerializeRollup(FlagEvalRollup rollup)
    {
        using var ms = new MemoryStream();
        using var w  = new Utf8JsonWriter(ms);
        w.WriteStartObject();
        w.WriteNumber("v", 1);
        w.WritePropertyName("u");
        w.WriteStartObject();
        foreach (var (uk, e) in rollup.U)
        {
            w.WritePropertyName(uk);
            e.WriteTo(w);
        }
        w.WriteEndObject();
        w.WriteEndObject();
        w.Flush();
        return System.Text.Encoding.UTF8.GetString(ms.ToArray());
    }
}
