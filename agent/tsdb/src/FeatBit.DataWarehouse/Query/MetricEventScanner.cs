using FeatBit.DataWarehouse.Storage;

namespace FeatBit.DataWarehouse.Query;

/// <summary>
/// Scans metric-event segments and aggregates results for users in the exposure map.
///
/// JOIN logic (mirrors MetricCollector.cs):
///   • user_key must be in <paramref name="exposureMap"/>
///   • occurred_at must be ≥ user's first_exposed_at  (post-exposure only)
///   • occurred_at must be within query.Start … query.End
///
/// Binary metric  → counts distinct exposed users who triggered ≥1 event (k).
/// Continuous metric → computes per-user aggregated value (once/sum/mean/count/latest),
///                     then returns per-variant (n, mean, variance, total).
/// </summary>
internal static class MetricEventScanner
{
    public static async Task<ExperimentResult> AggregateAsync(
        string dataRoot,
        ExperimentQuery query,
        IReadOnlyDictionary<string, ExposureEntry> exposureMap,
        CancellationToken ct)
    {
        bool isBinary = query.MetricType == "binary";

        // ── Per-user accumulators ─────────────────────────────────────────────
        // Shared across all segments; keyed by user_key.
        var perUser = new Dictionary<string, UserAccumulator>(exposureMap.Count);

        long startMs = query.Start.ToUnixTimeMilliseconds();
        long endMs   = query.End.ToUnixTimeMilliseconds();

        var startDate = DateOnly.FromDateTime(query.Start.UtcDateTime);
        var endDate   = DateOnly.FromDateTime(query.End.UtcDateTime);

        // ── Scan metric-event segments ─────────────────────────────────────────
        foreach (var dateDir in PathHelper.MetricEventDateDirs(
                     dataRoot, query.EnvId, query.MetricEvent, startDate, endDate))
        {
            foreach (var segPath in Directory.EnumerateFiles(
                         dateDir, $"*{SegmentConstants.FileExtension}").Order())
            {
                await ScanSegmentAsync(
                    segPath, query, exposureMap, perUser,
                    isBinary, startMs, endMs, ct);
            }
        }

        // ── Aggregate per variant ─────────────────────────────────────────────
        return isBinary
            ? BuildBinaryResult(query, exposureMap, perUser)
            : BuildContinuousResult(query, exposureMap, perUser);
    }

    // ── Segment scanning ──────────────────────────────────────────────────────

    private static async Task ScanSegmentAsync(
        string segPath,
        ExperimentQuery query,
        IReadOnlyDictionary<string, ExposureEntry> exposureMap,
        Dictionary<string, UserAccumulator> perUser,
        bool isBinary,
        long startMs, long endMs,
        CancellationToken ct)
    {
        var (header, dataOffset) = await SegmentReader.ReadHeaderAsync(segPath, ct);

        if (!SegmentReader.OverlapsTimeRange(header, startMs, endMs)) return;

        // For continuous metrics we need numeric_value; for binary we don't.
        var needed = isBinary
            ? new HashSet<string>(["timestamp", "user_key"])
            : new HashSet<string>(["timestamp", "user_key", "numeric_value"]);

        var cols = await SegmentReader.ReadSelectedColumnsAsync(
            segPath, header, dataOffset, needed, ct);

        var timestamps   = ColumnEncoder.DecodeTimestamps(cols["timestamp"],  header.RowCount);
        var userKeys     = ColumnEncoder.DecodeStrings(cols["user_key"],      header.RowCount);
        double?[]? numericValues = !isBinary
            ? ColumnEncoder.DecodeNullableDoubles(cols["numeric_value"], header.RowCount)
            : null;

        for (int i = 0; i < header.RowCount; i++)
        {
            long ts      = timestamps[i];
            string userKey = userKeys[i];

            if (ts < startMs || ts > endMs) continue;

            // Must be an exposed user
            if (!exposureMap.TryGetValue(userKey, out var exposure)) continue;

            // Post-exposure only: event must happen AFTER (or at) first evaluation
            if (ts < exposure.FirstExposedAt) continue;

            double? value = numericValues?[i];

            if (!perUser.TryGetValue(userKey, out var acc))
            {
                acc = new UserAccumulator();
                perUser[userKey] = acc;
            }

            acc.AddEvent(value, ts);
        }
    }

    // ── Result builders ───────────────────────────────────────────────────────

    private static ExperimentResult BuildBinaryResult(
        ExperimentQuery query,
        IReadOnlyDictionary<string, ExposureEntry> exposureMap,
        IReadOnlyDictionary<string, UserAccumulator> perUser)
    {
        // n = exposed (balanced) users per variant
        // k = distinct exposed users who triggered ≥1 event (any numeric_value)
        var variants = new Dictionary<string, VariantStats>(StringComparer.Ordinal);

        foreach (var variant in query.AllVariants)
        {
            long n = exposureMap.Values.Count(e => e.Variant == variant);
            long k = exposureMap
                .Where(kv => kv.Value.Variant == variant
                          && perUser.TryGetValue(kv.Key, out var acc)
                          && acc.HasConversion)
                .LongCount();

            variants[variant] = new BinaryVariantStats(n, k);
        }

        return new ExperimentResult { MetricType = query.MetricType, Variants = variants };
    }

    private static ExperimentResult BuildContinuousResult(
        ExperimentQuery query,
        IReadOnlyDictionary<string, ExposureEntry> exposureMap,
        IReadOnlyDictionary<string, UserAccumulator> perUser)
    {
        var variants = new Dictionary<string, VariantStats>(StringComparer.Ordinal);

        foreach (var variant in query.AllVariants)
        {
            // Collect per-user aggregated values for users with data
            var userValues = new List<double>();

            foreach (var (userKey, exposure) in exposureMap)
            {
                if (exposure.Variant != variant) continue;
                if (!perUser.TryGetValue(userKey, out var acc)) continue;

                var val = acc.GetValue(query.MetricAgg);
                if (val.HasValue) userValues.Add(val.Value);
            }

            if (userValues.Count == 0)
            {
                variants[variant] = new ContinuousVariantStats(0, 0, 0, 0);
                continue;
            }

            // Welford's one-pass algorithm for numerically stable mean + variance
            double mean = 0, m2 = 0, total = 0;
            int    n    = 0;

            foreach (var v in userValues)
            {
                n++;
                double delta  = v - mean;
                mean          += delta / n;
                m2            += delta * (v - mean);
                total         += v;
            }

            double variance = n > 1 ? m2 / (n - 1) : 0.0;
            variants[variant] = new ContinuousVariantStats(n, mean, variance, total);
        }

        return new ExperimentResult { MetricType = query.MetricType, Variants = variants };
    }

    // ── Per-user accumulator ──────────────────────────────────────────────────

    private sealed class UserAccumulator
    {
        // Binary: did any event fire?
        public bool HasConversion { get; private set; }

        // Continuous: track values for all five agg modes
        private long    _firstTs    = long.MaxValue;
        private double? _firstValue;
        private long    _latestTs   = long.MinValue;
        private double? _latestValue;
        private double  _sum;
        private int     _count;

        public void AddEvent(double? numericValue, long occurredAt)
        {
            HasConversion = true;
            if (!numericValue.HasValue) return;

            double v = numericValue.Value;

            if (occurredAt < _firstTs)  { _firstTs  = occurredAt; _firstValue  = v; }
            if (occurredAt > _latestTs) { _latestTs = occurredAt; _latestValue = v; }

            _sum += v;
            _count++;
        }

        /// <summary>
        /// Returns the per-user metric value for the requested aggregation.
        /// Returns null if no qualifying events were seen.
        /// </summary>
        public double? GetValue(string agg) => agg switch
        {
            "once"   => _firstValue,
            "sum"    => _count > 0 ? _sum              : (double?)null,
            "mean"   => _count > 0 ? _sum / _count     : (double?)null,
            "count"  => _count > 0 ? (double)_count    : (double?)null,
            "latest" => _latestValue,
            _        => _count > 0 ? _sum              : (double?)null, // default = sum
        };
    }
}
