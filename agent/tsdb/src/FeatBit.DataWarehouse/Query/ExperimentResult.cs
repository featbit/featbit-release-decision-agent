namespace FeatBit.DataWarehouse.Query;

// ── Per-variant statistics ────────────────────────────────────────────────────

/// <summary>Base for variant statistics — either binary or continuous.</summary>
public abstract record VariantStats;

/// <summary>
/// Binary (proportion) metric result.
///   n = exposed &amp; balanced users
///   k = distinct exposed users who triggered the metric event
///
/// Matches the {n, k} format expected by the Python <c>analyze-bayesian.py</c>.
/// </summary>
public sealed record BinaryVariantStats(long N, long K) : VariantStats;

/// <summary>
/// Continuous metric result.
///   n        = users with at least one non-null numeric event value
///   mean     = VAR_SAMP-style mean of per-user aggregated values
///   variance = sample variance (VAR_SAMP) of per-user aggregated values
///   total    = sum of per-user aggregated values
///
/// Matches the {n, mean, variance} format expected by the Python analyzer.
/// </summary>
public sealed record ContinuousVariantStats(
    long N, double Mean, double Variance, double Total) : VariantStats;

// ── Experiment result ─────────────────────────────────────────────────────────

/// <summary>
/// Aggregated statistics for one experiment metric, keyed by variant name.
/// </summary>
public sealed class ExperimentResult
{
    /// <summary>binary | revenue | count | duration</summary>
    public required string MetricType { get; init; }

    /// <summary>
    /// Variant name → stats.  Always contains the control variant and
    /// all requested treatment variants (zero-valued if no data).
    /// </summary>
    public required IReadOnlyDictionary<string, VariantStats> Variants { get; init; }

    /// <summary>Convenience accessor for binary results.</summary>
    public BinaryVariantStats? GetBinary(string variant) =>
        Variants.TryGetValue(variant, out var v) ? v as BinaryVariantStats : null;

    /// <summary>Convenience accessor for continuous results.</summary>
    public ContinuousVariantStats? GetContinuous(string variant) =>
        Variants.TryGetValue(variant, out var v) ? v as ContinuousVariantStats : null;

    /// <summary>
    /// Convert to the nested-dict format consumed by <c>analyze-bayesian.py</c>:
    /// <code>
    /// {
    ///   "purchase": {
    ///     "control":   {"n": 1000, "k": 120},
    ///     "treatment": {"n": 1000, "k": 145}
    ///   }
    /// }
    /// </code>
    /// </summary>
    public Dictionary<string, object> ToPythonInputDict(string metricLabel) =>
        new()
        {
            [metricLabel] = Variants.ToDictionary(
                kv => kv.Key,
                kv => (object)(kv.Value switch
                {
                    BinaryVariantStats b     => new { n = b.N, k = b.K },
                    ContinuousVariantStats c => new { n = c.N, mean = c.Mean, variance = c.Variance },
                    _                        => new { }
                }))
        };
}
