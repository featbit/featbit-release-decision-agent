namespace Core.Models;

public sealed class EvaluationResult
{
    public string RecipeId { get; set; } = string.Empty;

    public string DecisionKey { get; set; } = string.Empty;

    public MetricEvaluation PrimaryMetric { get; set; } = new();

    public List<GuardrailEvaluation> Guardrails { get; set; } = [];

    public string Recommendation { get; set; } = RecommendationNames.Inconclusive;

    public int RecommendedNextRolloutPercentage { get; set; }

    public List<string> Reasoning { get; set; } = [];
}

public sealed class MetricEvaluation
{
    public string Name { get; set; } = string.Empty;

    public string BaselineVariant { get; set; } = string.Empty;

    public string CandidateVariant { get; set; } = string.Empty;

    public double BaselineValue { get; set; }

    public double CandidateValue { get; set; }

    public double AbsoluteDelta { get; set; }

    public double RelativeDelta { get; set; }
}

public sealed class GuardrailEvaluation
{
    public string Name { get; set; } = string.Empty;

    public double BaselineValue { get; set; }

    public double CandidateValue { get; set; }

    public double RelativeDelta { get; set; }

    public string Status { get; set; } = "pass";
}

public static class RecommendationNames
{
    public const string Continue = "continue";
    public const string Pause = "pause";
    public const string RollbackCandidate = "rollback_candidate";
    public const string Inconclusive = "inconclusive";
}
