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
        // Derive table type from path:  deltas/flag-evals/... or deltas/metric-events/...
        var isFlagEval = deltaKey.StartsWith("deltas/flag-evals/");
        var rollupKey  = DeltaKeyToRollupKey(deltaKey, isFlagEval);

        log.LogInformation("Processing delta {Delta} → rollup {Rollup}", deltaKey, rollupKey);

        var deltaJson  = await r2.GetStringAsync(deltaKey, ct);
        if (deltaJson is null) { log.LogWarning("Delta not found: {Key}", deltaKey); return; }

        var delta = JsonSerializer.Deserialize<DeltaFile>(deltaJson, JsonOpts);
        if (delta is null || delta.U.Count == 0) { await r2.DeleteAsync(deltaKey, ct); return; }

        if (isFlagEval)
            await MergeFlagEvalAsync(rollupKey, delta, ct);
        else
            await MergeMetricEventAsync(rollupKey, delta, ct);

        await r2.DeleteAsync(deltaKey, ct);
        log.LogInformation("Done: {Delta}", deltaKey);
    }

    // ── Flag-eval merge ───────────────────────────────────────────────────────

    private async Task MergeFlagEvalAsync(string rollupKey, DeltaFile delta, CancellationToken ct)
    {
        var rollupJson = await r2.GetStringAsync(rollupKey, ct);
        var rollup     = rollupJson is not null
            ? JsonSerializer.Deserialize<FlagEvalRollup>(rollupJson, JsonOpts) ?? new()
            : new FlagEvalRollup();

        // Merge: keep entry with min timestamp
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

        await r2.PutStringAsync(rollupKey, SerializeRollup(rollup), ct);
    }

    // ── Metric-event merge ────────────────────────────────────────────────────

    private async Task MergeMetricEventAsync(string rollupKey, DeltaFile delta, CancellationToken ct)
    {
        var rollupJson = await r2.GetStringAsync(rollupKey, ct);
        var rollup     = rollupJson is not null
            ? JsonSerializer.Deserialize<MetricEventRollup>(rollupJson, JsonOpts) ?? new()
            : new MetricEventRollup();

        // Convert existing entries to mutable accumulators
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

        // Serialize back
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
