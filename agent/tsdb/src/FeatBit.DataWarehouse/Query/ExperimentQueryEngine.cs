namespace FeatBit.DataWarehouse.Query;

/// <summary>
/// Orchestrates the full experiment metric query.
///
/// Execution plan (mirrors MetricCollector.cs SQL logic):
///
///  Step 1 — Build exposure map
///    Scan flag-eval segments for (env_id, flag_key, time_range).
///    Apply: variant filter, experiment_id, layer_id, traffic bucket, audience filters.
///    Keep first evaluation per user (min timestamp across all segments).
///
///  Step 2 — Balance variants  (skipped for bandit)
///    Downsample over-represented variants to min(n_control, n_treatment)
///    using deterministic hash(user_key) — identical to the ROW_NUMBER()
///    OVER (ORDER BY abs(hashtext(user_key))) approach in SQL.
///
///  Step 3 — Aggregate metric events
///    Scan metric-event segments for (env_id, event_name, time_range).
///    Join on user_key ∈ exposureMap AND occurred_at ≥ first_exposed_at.
///    Compute per-user value (once/sum/mean/count/latest), then per-variant stats.
///
/// Output: ExperimentResult → feed directly into analyze-bayesian.py via stdin.
/// </summary>
public sealed class ExperimentQueryEngine(string dataRoot)
{
    /// <summary>
    /// Execute a single metric query and return aggregated statistics.
    /// Intended to replace <c>MetricCollector.CollectAsync</c> in DataServer.
    /// </summary>
    public async Task<ExperimentResult> QueryAsync(
        ExperimentQuery query, CancellationToken ct = default)
    {
        // ── Step 1: Build exposure map ────────────────────────────────────────
        var exposureMap = await FlagEvalScanner.BuildAsync(dataRoot, query, ct);

        if (exposureMap.Count == 0)
            return EmptyResult(query);

        // ── Step 2: Balance variants (bayesian_ab only) ───────────────────────
        FlagEvalScanner.Balance(exposureMap, query);

        if (exposureMap.Count == 0)
            return EmptyResult(query);

        // ── Step 3: Aggregate metric events ───────────────────────────────────
        return await MetricEventScanner.AggregateAsync(dataRoot, query, exposureMap, ct);
    }

    /// <summary>
    /// Execute queries for a primary metric and zero or more guardrail metrics in parallel.
    /// </summary>
    public async Task<IReadOnlyDictionary<string, ExperimentResult>> QueryManyAsync(
        ExperimentQuery primaryQuery,
        IReadOnlyList<string>? guardrailEventNames = null,
        CancellationToken ct = default)
    {
        // Exposure map is the same for all metrics — build it once.
        var exposureMap = await FlagEvalScanner.BuildAsync(dataRoot, primaryQuery, ct);
        FlagEvalScanner.Balance(exposureMap, primaryQuery);

        if (exposureMap.Count == 0)
        {
            var empty = new Dictionary<string, ExperimentResult>
            {
                [primaryQuery.MetricEvent] = EmptyResult(primaryQuery),
            };
            if (guardrailEventNames is not null)
                foreach (var g in guardrailEventNames)
                    empty[g] = EmptyResult(GuardrailQuery(primaryQuery, g));
            return empty;
        }

        // Build all metric queries sharing the same exposure map (already balanced).
        var allMetrics = new List<(string Event, ExperimentQuery Q)>
        {
            (primaryQuery.MetricEvent, primaryQuery),
        };

        if (guardrailEventNames is not null)
            foreach (var g in guardrailEventNames)
                allMetrics.Add((g, GuardrailQuery(primaryQuery, g)));

        // Scan all metric event tables in parallel.
        var tasks = allMetrics.Select(async m =>
        {
            var result = await MetricEventScanner.AggregateAsync(
                dataRoot, m.Q, exposureMap, ct);
            return (m.Event, result);
        });

        var results = await Task.WhenAll(tasks);
        return results.ToDictionary(r => r.Event, r => r.result);
    }

    // ── Helpers ───────────────────────────────────────────────────────────────

    private static ExperimentQuery GuardrailQuery(ExperimentQuery src, string eventName) => new()
    {
        EnvId             = src.EnvId,
        FlagKey           = src.FlagKey,
        MetricEvent       = eventName,
        MetricType        = "binary",
        MetricAgg         = "once",
        ControlVariant    = src.ControlVariant,
        TreatmentVariants = src.TreatmentVariants,
        Start             = src.Start,
        End               = src.End,
        ExperimentId      = src.ExperimentId,
        LayerId           = src.LayerId,
        TrafficPercent    = src.TrafficPercent,
        TrafficOffset     = src.TrafficOffset,
        AudienceFilters   = src.AudienceFilters,
        Method            = src.Method,
    };

    private static ExperimentResult EmptyResult(ExperimentQuery query)
    {
        VariantStats zero = query.MetricType == "binary"
            ? new BinaryVariantStats(0, 0)
            : new ContinuousVariantStats(0, 0, 0, 0);

        return new ExperimentResult
        {
            MetricType = query.MetricType,
            Variants   = query.AllVariants.ToDictionary(v => v, _ => zero),
        };
    }
}
