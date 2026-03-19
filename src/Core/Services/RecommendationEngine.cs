using Core.Models;

namespace Core.Services;

public sealed class RecommendationEngine
{
    public EvaluationResult Apply(EvaluationResult result, int currentRolloutPercentage)
    {
        result.Reasoning.Clear();

        if (result.Guardrails.Any(guardrail => string.Equals(guardrail.Status, "fail", StringComparison.OrdinalIgnoreCase)))
        {
            result.Recommendation = RecommendationNames.Pause;
            result.RecommendedNextRolloutPercentage = currentRolloutPercentage;
            result.Reasoning.Add("At least one guardrail regression exceeded the allowed threshold.");
            return result;
        }

        if (result.PrimaryMetric.RelativeDelta > 0)
        {
            result.Recommendation = RecommendationNames.Continue;
            result.RecommendedNextRolloutPercentage = 25;
            result.Reasoning.Add("Primary metric improved.");
            result.Reasoning.Add("No guardrail regression detected.");
            return result;
        }

        if (result.PrimaryMetric.RelativeDelta < 0)
        {
            result.Recommendation = RecommendationNames.RollbackCandidate;
            result.RecommendedNextRolloutPercentage = 0;
            result.Reasoning.Add("Primary metric worsened.");
            return result;
        }

        result.Recommendation = RecommendationNames.Inconclusive;
        result.RecommendedNextRolloutPercentage = currentRolloutPercentage;
        result.Reasoning.Add("Primary metric did not improve enough to justify expansion.");
        return result;
    }
}
