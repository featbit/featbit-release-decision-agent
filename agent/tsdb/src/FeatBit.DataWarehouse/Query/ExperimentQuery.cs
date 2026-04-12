namespace FeatBit.DataWarehouse.Query;

/// <summary>
/// Parameters for one experiment metric query.
/// Mirrors <c>ExperimentParams</c> in the DataServer project, extended to support
/// multi-arm experiments (multiple treatment variants).
/// </summary>
public sealed class ExperimentQuery
{
    // ── Partition keys ────────────────────────────────────────────────────────

    public required string EnvId   { get; init; }
    public required string FlagKey { get; init; }

    // ── Metric ────────────────────────────────────────────────────────────────

    /// <summary>The custom event name to measure (e.g. "purchase", "click").</summary>
    public required string MetricEvent { get; init; }

    /// <summary>binary | revenue | count | duration</summary>
    public required string MetricType { get; init; }

    /// <summary>
    /// Aggregation function applied per user before variant-level statistics.
    /// once | sum | mean | count | latest  (ignored for binary metrics).
    /// </summary>
    public string MetricAgg { get; init; } = "once";

    // ── Variants ──────────────────────────────────────────────────────────────

    public required string ControlVariant { get; init; }

    /// <summary>
    /// One or more treatment variant values.  Multi-arm experiments pass several items.
    /// Matches the comma-separated <c>treatmentVariant</c> field in experiment records.
    /// </summary>
    public required IReadOnlyList<string> TreatmentVariants { get; init; }

    /// <summary>All variant names (control + treatments).</summary>
    public IReadOnlyList<string> AllVariants => [ControlVariant, .. TreatmentVariants];

    // ── Observation window ────────────────────────────────────────────────────

    public required DateTimeOffset Start { get; init; }
    public required DateTimeOffset End   { get; init; }

    // ── Exposure filters ──────────────────────────────────────────────────────

    /// <summary>
    /// Restrict to evaluations tagged with this experiment ID.
    /// null = no filter (matches any experiment_id).
    /// </summary>
    public string? ExperimentId { get; init; }

    /// <summary>Mutual-exclusion layer. null = no filter.</summary>
    public string? LayerId { get; init; }

    /// <summary>
    /// 0–100.  100 = include all users (no bucket filter).
    /// Combined with <see cref="TrafficOffset"/> to select bucket range:
    ///   hash_bucket ∈ [TrafficOffset, TrafficOffset + TrafficPercent).
    /// </summary>
    public int TrafficPercent { get; init; } = 100;

    /// <summary>0–99.  Bucket start index.</summary>
    public int TrafficOffset { get; init; } = 0;

    /// <summary>
    /// User property filters (eq / neq / in / nin).
    /// Applied to <c>user_props</c> captured at flag evaluation time.
    /// null or empty = no audience restriction.
    /// </summary>
    public IReadOnlyList<AudienceFilter>? AudienceFilters { get; init; }

    // ── Analysis method ───────────────────────────────────────────────────────

    /// <summary>
    /// bayesian_ab  — balanced sampling (equal N per variant).
    /// bandit        — all data per arm, no downsampling.
    /// </summary>
    public string Method { get; init; } = "bayesian_ab";
}
