using FeatBit.ReleaseDecision.Cli.Data;
using FeatBit.ReleaseDecision.Cli.Models;

namespace FeatBit.ReleaseDecision.Cli.Engine;

/// <summary>
/// Applies the decision policy rules from the recipe spec to produce a ResultsJson.
/// Primary metric: task_success_rate — higher is better.
/// Guardrails: avg_cost, p95_latency_ms — lower is better; fail when relative increase > 10%.
/// </summary>
public static class DecisionPolicy
{
    private const double GuardrailRegressionThreshold = 0.10;
    private const double PrimaryMetricClearWorseThreshold = -0.05;

    public static ResultsJson Apply(PlanJson plan, VariantMetrics[] variantMetrics)
    {
        var baseline = variantMetrics.FirstOrDefault(m =>
            m.Variant.Equals(plan.Variants[0], StringComparison.OrdinalIgnoreCase));
        var candidate = variantMetrics.FirstOrDefault(m =>
            m.Variant.Equals(plan.Variants[1], StringComparison.OrdinalIgnoreCase));

        if (baseline == null || candidate == null)
        {
            var missing = string.Join(", ", new[] { baseline, candidate }
                .Select((m, i) => m == null ? plan.Variants[i] : null)
                .Where(v => v != null));
            return new ResultsJson
            {
                RecipeId = plan.RecipeId,
                DecisionKey = plan.DecisionKey,
                PrimaryMetric = new PrimaryMetricResult { Name = plan.PrimaryMetric },
                Guardrails = [],
                Recommendation = "inconclusive",
                RecommendedNextRolloutPercentage = plan.RolloutPercentage,
                Reasoning = [$"Insufficient data: variant(s) had no rows in the time range: {missing}"]
            };
        }

        // Primary metric: task_success_rate (higher is better)
        var primaryAbsDelta = candidate.TaskSuccessRate - baseline.TaskSuccessRate;
        var primaryRelDelta = baseline.TaskSuccessRate > 0
            ? primaryAbsDelta / baseline.TaskSuccessRate
            : 0.0;

        var primaryMetricResult = new PrimaryMetricResult
        {
            Name = plan.PrimaryMetric,
            BaselineVariant = plan.Variants[0],
            CandidateVariant = plan.Variants[1],
            BaselineValue = Round(baseline.TaskSuccessRate),
            CandidateValue = Round(candidate.TaskSuccessRate),
            AbsoluteDelta = Round(primaryAbsDelta),
            RelativeDelta = Round(primaryRelDelta)
        };

        // Guardrails
        var guardrailResults = (plan.Guardrails ?? [])
            .Select(name => EvaluateGuardrail(name, baseline, candidate))
            .ToArray();

        var anyGuardrailFailed = guardrailResults.Any(g => g.Status == "fail");
        var primaryImproved = primaryRelDelta > 0;
        var primaryClearlyWorsened = primaryRelDelta < PrimaryMetricClearWorseThreshold;

        string recommendation;
        int nextRollout;
        var reasoning = new List<string>();

        if (anyGuardrailFailed)
        {
            recommendation = "pause";
            nextRollout = plan.RolloutPercentage;
            var failed = guardrailResults.Where(g => g.Status == "fail").Select(g => g.Name);
            reasoning.Add($"Guardrail regression detected: {string.Join(", ", failed)}");
        }
        else if (primaryClearlyWorsened)
        {
            recommendation = "rollback_candidate";
            nextRollout = 0;
            reasoning.Add("Primary metric clearly worsened");
            reasoning.Add("No guardrail regression detected");
        }
        else if (primaryImproved)
        {
            recommendation = "continue";
            nextRollout = NextRolloutStep(plan.RolloutPercentage);
            reasoning.Add("Primary metric improved");
            reasoning.Add("No guardrail regression detected");
        }
        else
        {
            recommendation = "inconclusive";
            nextRollout = plan.RolloutPercentage;
            reasoning.Add("Primary metric did not improve significantly");
            reasoning.Add("No guardrail regression detected");
        }

        return new ResultsJson
        {
            RecipeId = plan.RecipeId,
            DecisionKey = plan.DecisionKey,
            PrimaryMetric = primaryMetricResult,
            Guardrails = guardrailResults,
            Recommendation = recommendation,
            RecommendedNextRolloutPercentage = nextRollout,
            Reasoning = [.. reasoning]
        };
    }

    private static GuardrailResult EvaluateGuardrail(
        string name,
        VariantMetrics baseline,
        VariantMetrics candidate)
    {
        double baseVal, candVal;
        switch (name.ToLowerInvariant())
        {
            case "avg_cost":    baseVal = baseline.AvgCost;     candVal = candidate.AvgCost;     break;
            case "p95_latency_ms": baseVal = baseline.P95LatencyMs; candVal = candidate.P95LatencyMs; break;
            default:
                return new GuardrailResult { Name = name, Status = "pass" };
        }

        var relDelta = baseVal > 0 ? (candVal - baseVal) / baseVal : 0.0;
        return new GuardrailResult
        {
            Name = name,
            BaselineValue = Round(baseVal),
            CandidateValue = Round(candVal),
            RelativeDelta = Round(relDelta),
            Status = relDelta > GuardrailRegressionThreshold ? "fail" : "pass"
        };
    }

    // Step the rollout percentage up the standard progression
    private static int NextRolloutStep(int current) => current switch
    {
        <= 10 => 25,
        <= 25 => 50,
        <= 50 => 75,
        _ => 100
    };

    private static double Round(double v) => Math.Round(v, 4);
}
