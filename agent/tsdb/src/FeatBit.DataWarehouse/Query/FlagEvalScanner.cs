using System.IO.Hashing;
using System.Text;
using System.Text.Json;
using FeatBit.DataWarehouse.Storage;

namespace FeatBit.DataWarehouse.Query;

/// <summary>
/// Scans flag-evaluation segments to build an exposure map:
///   user_key → (first_exposed_at_ms, variant)
///
/// Mirrors the <c>first_exposure</c> CTE in MetricCollector.cs:
///   • Filters by time range, experiment_id, layer_id, traffic bucket, audience properties
///   • Keeps only the FIRST evaluation per user (min timestamp across all segments)
///   • Applies balanced sampling when method = "bayesian_ab"
/// </summary>
internal static class FlagEvalScanner
{
    // ── Public API ────────────────────────────────────────────────────────────

    /// <summary>
    /// Build the exposure map for an experiment query.
    /// Returns user_key → ExposureEntry (first_exposed_at, variant).
    /// Only control and treatment variants are included.
    /// After this call, call <see cref="Balance"/> if method = "bayesian_ab".
    /// </summary>
    public static async Task<Dictionary<string, ExposureEntry>> BuildAsync(
        string dataRoot, ExperimentQuery query, CancellationToken ct)
    {
        var exposureMap = new Dictionary<string, ExposureEntry>(capacity: 64_000);

        long startMs = query.Start.ToUnixTimeMilliseconds();
        long endMs   = query.End.ToUnixTimeMilliseconds();

        var startDate = DateOnly.FromDateTime(query.Start.UtcDateTime);
        var endDate   = DateOnly.FromDateTime(query.End.UtcDateTime);

        var validVariants = new HashSet<string>(query.AllVariants, StringComparer.Ordinal);

        bool needExperimentId = query.ExperimentId is not null;
        bool needLayerId      = query.LayerId is not null;
        bool needBucket       = query.TrafficPercent < 100;
        bool needProps        = query.AudienceFilters is { Count: > 0 };

        foreach (var dateDir in PathHelper.FlagEvalDateDirs(
                     dataRoot, query.EnvId, query.FlagKey, startDate, endDate))
        {
            foreach (var segPath in Directory.EnumerateFiles(
                         dateDir, $"*{SegmentConstants.FileExtension}").Order())
            {
                await ScanSegmentAsync(
                    segPath, query, exposureMap, validVariants,
                    startMs, endMs,
                    needExperimentId, needLayerId, needBucket, needProps,
                    ct);
            }
        }

        return exposureMap;
    }

    /// <summary>
    /// Balanced sampling (for bayesian_ab): downsample the larger variant(s) to
    /// min(n_control, n_treatment …) using a deterministic hash on user_key.
    /// Equivalent to the <c>exposure</c> CTE in MetricCollector.cs.
    /// No-op for bandit experiments.
    /// </summary>
    public static void Balance(
        Dictionary<string, ExposureEntry> exposureMap, ExperimentQuery query)
    {
        if (query.Method is "bandit") return;

        // Count per variant
        var counts = new Dictionary<string, int>(StringComparer.Ordinal);
        foreach (var (_, e) in exposureMap)
            counts[e.Variant] = counts.GetValueOrDefault(e.Variant) + 1;

        if (counts.Count < 2) return;

        int minCount = counts.Values.Min();

        // Collect users per over-represented variant, sort by hash, remove tail
        foreach (var (variant, count) in counts)
        {
            if (count <= minCount) continue;

            var toRemove = exposureMap
                .Where(kv => kv.Value.Variant == variant)
                .OrderBy(kv => HashForBalance(kv.Key))
                .Skip(minCount)
                .Select(kv => kv.Key)
                .ToList();

            foreach (var key in toRemove)
                exposureMap.Remove(key);
        }
    }

    // ── Per-segment scan ──────────────────────────────────────────────────────

    private static async Task ScanSegmentAsync(
        string segPath,
        ExperimentQuery query,
        Dictionary<string, ExposureEntry> exposureMap,
        HashSet<string> validVariants,
        long startMs, long endMs,
        bool needExperimentId, bool needLayerId, bool needBucket, bool needProps,
        CancellationToken ct)
    {
        var (header, dataOffset) = await SegmentReader.ReadHeaderAsync(segPath, ct);

        // Zone-map pruning: skip segment if timestamps don't overlap the query window.
        if (!SegmentReader.OverlapsTimeRange(header, startMs, endMs)) return;

        // Determine which columns we actually need to read.
        var needed = new HashSet<string>(["timestamp", "user_key", "variant"]);
        if (needExperimentId) needed.Add("experiment_id");
        if (needLayerId)      needed.Add("layer_id");
        if (needBucket)       needed.Add("hash_bucket");
        if (needProps)        needed.Add("user_props");

        var cols = await SegmentReader.ReadSelectedColumnsAsync(
            segPath, header, dataOffset, needed, ct);

        // Decode only the columns we fetched
        var timestamps   = ColumnEncoder.DecodeTimestamps(cols["timestamp"],  header.RowCount);
        var userKeys     = ColumnEncoder.DecodeStrings(cols["user_key"],      header.RowCount);
        var variants     = ColumnEncoder.DecodeStrings(cols["variant"],       header.RowCount);

        string?[]? experimentIds = needExperimentId
            ? ColumnEncoder.DecodeNullableStrings(cols["experiment_id"], header.RowCount) : null;
        string?[]? layerIds      = needLayerId
            ? ColumnEncoder.DecodeNullableStrings(cols["layer_id"],      header.RowCount) : null;
        byte[]?   hashBuckets   = needBucket
            ? ColumnEncoder.DecodeBytes(cols["hash_bucket"], header.RowCount) : null;
        string?[]? userPropsJsons = needProps
            ? ColumnEncoder.DecodeNullableStrings(cols["user_props"], header.RowCount) : null;

        // Row-level filtering
        for (int i = 0; i < header.RowCount; i++)
        {
            long ts = timestamps[i];
            if (ts < startMs || ts > endMs) continue;

            // Only keep rows whose variant is control or one of the treatments
            var variant = variants[i];
            if (!validVariants.Contains(variant)) continue;

            // experiment_id filter (null param = "skip filter"; row value null = skip row)
            if (experimentIds is not null && experimentIds[i] != query.ExperimentId) continue;

            // layer_id filter
            if (layerIds is not null && layerIds[i] != query.LayerId) continue;

            // Traffic bucket: hash_bucket ∈ [offset, offset + percent)
            if (hashBuckets is not null)
            {
                int bucket = hashBuckets[i];
                if (bucket < query.TrafficOffset
                    || bucket >= query.TrafficOffset + query.TrafficPercent) continue;
            }

            // Audience property filters
            if (userPropsJsons is not null && query.AudienceFilters is { Count: > 0 })
            {
                var propsJson = userPropsJsons[i];
                IReadOnlyDictionary<string, string>? props =
                    propsJson is not null
                        ? JsonSerializer.Deserialize<Dictionary<string, string>>(propsJson)
                        : null;

                bool passes = true;
                foreach (var f in query.AudienceFilters)
                {
                    if (!f.Matches(props)) { passes = false; break; }
                }
                if (!passes) continue;
            }

            // Keep only the FIRST evaluation per user (min timestamp)
            var userKey = userKeys[i];
            if (exposureMap.TryGetValue(userKey, out var existing))
            {
                if (ts < existing.FirstExposedAt)
                    exposureMap[userKey] = new ExposureEntry(ts, variant);
            }
            else
            {
                exposureMap[userKey] = new ExposureEntry(ts, variant);
            }
        }
    }

    // ── Helpers ───────────────────────────────────────────────────────────────

    private static ulong HashForBalance(string userKey)
    {
        int maxBytes = Encoding.UTF8.GetMaxByteCount(userKey.Length);
        Span<byte> buf = maxBytes <= 256 ? stackalloc byte[maxBytes] : new byte[maxBytes];
        int len = Encoding.UTF8.GetBytes(userKey, buf);
        return XxHash3.HashToUInt64(buf[..len]);
    }
}

/// <summary>First-exposure data for a user in an experiment.</summary>
internal readonly record struct ExposureEntry(long FirstExposedAt, string Variant);
