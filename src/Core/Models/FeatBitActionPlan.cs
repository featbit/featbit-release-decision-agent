namespace Core.Models;

public sealed class FeatBitActionPlan
{
    public string DecisionKey { get; set; } = string.Empty;

    public List<FeatBitAction> Actions { get; set; } = [];
}

public sealed class FeatBitAction
{
    public string Type { get; set; } = string.Empty;

    public string? FlagKind { get; set; }

    public List<string>? Variants { get; set; }

    public int? Percentage { get; set; }
}
