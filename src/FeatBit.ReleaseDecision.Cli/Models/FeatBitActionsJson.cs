using System.Text.Json.Serialization;

namespace FeatBit.ReleaseDecision.Cli.Models;

public sealed class FeatBitActionsJson
{
    [JsonPropertyName("decision_key")]
    public string DecisionKey { get; set; } = "";

    [JsonPropertyName("actions")]
    public FeatBitAction[] Actions { get; set; } = [];
}

public sealed class FeatBitAction
{
    [JsonPropertyName("type")]
    public string Type { get; set; } = "";

    [JsonPropertyName("flag_kind")]
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public string? FlagKind { get; set; }

    [JsonPropertyName("variants")]
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public string[]? Variants { get; set; }

    // int? so that percentage=0 is still written (rollback case), but null is omitted
    [JsonPropertyName("percentage")]
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public int? Percentage { get; set; }
}
