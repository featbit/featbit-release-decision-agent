namespace Core.Models;

public sealed class ExperimentPlan
{
    public string RecipeId { get; set; } = string.Empty;

    public string DecisionKey { get; set; } = string.Empty;

    public List<string> Variants { get; set; } = [];

    public string RandomizationUnit { get; set; } = string.Empty;

    public string PrimaryMetric { get; set; } = string.Empty;

    public List<string> Guardrails { get; set; } = [];

    public int RolloutPercentage { get; set; }

    public string DataSourceKind { get; set; } = string.Empty;

    public string Table { get; set; } = string.Empty;

    public TimeRange TimeRange { get; set; } = new();

    public string? Notes { get; set; }

    public string? UserGoal { get; set; }

    public List<string> Boundaries { get; set; } = [];

    public string? PageScope { get; set; }

    public string? TargetAudience { get; set; }

    public string? ProtectedAudience { get; set; }
}

public sealed class TimeRange
{
    public string Start { get; set; } = string.Empty;

    public string End { get; set; } = string.Empty;
}
