using System.Text.Json.Serialization;

namespace FeatBit.ReleaseDecision.Cli.Models;

public sealed class PlanJson
{
    [JsonPropertyName("recipe_id")]
    public string RecipeId { get; set; } = "";

    [JsonPropertyName("decision_key")]
    public string DecisionKey { get; set; } = "";

    [JsonPropertyName("variants")]
    public string[] Variants { get; set; } = [];

    [JsonPropertyName("randomization_unit")]
    public string RandomizationUnit { get; set; } = "";

    [JsonPropertyName("primary_metric")]
    public string PrimaryMetric { get; set; } = "";

    [JsonPropertyName("guardrails")]
    public string[] Guardrails { get; set; } = [];

    [JsonPropertyName("rollout_percentage")]
    public int RolloutPercentage { get; set; }

    [JsonPropertyName("data_source_kind")]
    public string DataSourceKind { get; set; } = "";

    [JsonPropertyName("table")]
    public string Table { get; set; } = "";

    [JsonPropertyName("time_range")]
    public TimeRange TimeRange { get; set; } = new();

    // Optional fields
    [JsonPropertyName("notes")]
    public string? Notes { get; set; }

    [JsonPropertyName("user_goal")]
    public string? UserGoal { get; set; }

    [JsonPropertyName("boundaries")]
    public string[]? Boundaries { get; set; }

    [JsonPropertyName("page_scope")]
    public string? PageScope { get; set; }

    [JsonPropertyName("target_audience")]
    public string? TargetAudience { get; set; }

    [JsonPropertyName("protected_audience")]
    public string? ProtectedAudience { get; set; }

    [JsonPropertyName("column_mappings")]
    public Dictionary<string, string>? ColumnMappings { get; set; }
}

public sealed class TimeRange
{
    [JsonPropertyName("start")]
    public string Start { get; set; } = "";

    [JsonPropertyName("end")]
    public string End { get; set; } = "";
}
