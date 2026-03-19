using Core.Models;
using System.Globalization;

namespace Core.Services;

public sealed class SummaryWriter
{
    public string Create(EvaluationResult result)
    {
        var primaryDeltaPercent = FormatSignedPercent(result.PrimaryMetric.RelativeDelta);
        var recommendationText = CreateRecommendationText(result.Recommendation, result.RecommendedNextRolloutPercentage);

        return string.Join(Environment.NewLine, [
            "# Release Decision Summary",
            string.Empty,
            $"Decision key: `{result.DecisionKey}`",
            string.Empty,
            "## Result",
            $"`{result.PrimaryMetric.CandidateVariant}` changes `{result.PrimaryMetric.Name}` by **{primaryDeltaPercent}** versus `{result.PrimaryMetric.BaselineVariant}`.",
            string.Empty,
            "## Guardrails",
            .. result.Guardrails.Select(guardrail => $"- {guardrail.Name}: {guardrail.Status} ({FormatSignedPercent(guardrail.RelativeDelta)})"),
            string.Empty,
            "## Recommendation",
            recommendationText,
            string.Empty,
            "## Note",
            "This recommendation is based on deterministic rule-based metric comparison in the MVP and is not a formal statistical conclusion."
        ]);
    }

    private static string CreateRecommendationText(string recommendation, int rolloutPercentage)
    {
        return recommendation switch
        {
            RecommendationNames.Continue => $"Continue rollout to **{rolloutPercentage}%**.",
            RecommendationNames.Pause => $"Pause at the current rollout of **{rolloutPercentage}%**.",
            RecommendationNames.RollbackCandidate => "Treat this variant as a rollback candidate and reduce rollout to **0%**.",
            _ => $"Result is inconclusive. Keep the current rollout at **{rolloutPercentage}%**."
        };
    }

    private static string FormatSignedPercent(double value)
    {
        return value.ToString("+0.0%;-0.0%;0.0%", CultureInfo.InvariantCulture);
    }
}