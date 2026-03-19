using System.Text.Json.Serialization;

namespace FeatBit.ReleaseDecision.Cli.Models;

public sealed class ResultsJson
{
    [JsonPropertyName("recipe_id")]
    public string RecipeId { get; set; } = "";

    [JsonPropertyName("decision_key")]
    public string DecisionKey { get; set; } = "";

    [JsonPropertyName("primary_metric")]
    public PrimaryMetricResult PrimaryMetric { get; set; } = new();

    [JsonPropertyName("guardrails")]
    public GuardrailResult[] Guardrails { get; set; } = [];

    [JsonPropertyName("recommendation")]
    public string Recommendation { get; set; } = "";

    [JsonPropertyName("recommended_next_rollout_percentage")]
    public int RecommendedNextRolloutPercentage { get; set; }

    [JsonPropertyName("reasoning")]
    public string[] Reasoning { get; set; } = [];
}

public sealed class PrimaryMetricResult
{
    [JsonPropertyName("name")]
    public string Name { get; set; } = "";

    [JsonPropertyName("baseline_variant")]
    public string BaselineVariant { get; set; } = "";

    [JsonPropertyName("candidate_variant")]
    public string CandidateVariant { get; set; } = "";

    [JsonPropertyName("baseline_value")]
    public double BaselineValue { get; set; }

    [JsonPropertyName("candidate_value")]
    public double CandidateValue { get; set; }

    [JsonPropertyName("absolute_delta")]
    public double AbsoluteDelta { get; set; }

    [JsonPropertyName("relative_delta")]
    public double RelativeDelta { get; set; }
}

public sealed class GuardrailResult
{
    [JsonPropertyName("name")]
    public string Name { get; set; } = "";

    [JsonPropertyName("baseline_value")]
    public double BaselineValue { get; set; }

    [JsonPropertyName("candidate_value")]
    public double CandidateValue { get; set; }

    [JsonPropertyName("relative_delta")]
    public double RelativeDelta { get; set; }

    [JsonPropertyName("status")]
    public string Status { get; set; } = "pass";
}
