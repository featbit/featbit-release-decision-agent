using FeatBit.ReleaseDecision.Cli.Models;

namespace FeatBit.ReleaseDecision.Cli.Engine;

public static class ActionsDeriving
{
    public static FeatBitActionsJson Derive(PlanJson plan) =>
        new()
        {
            DecisionKey = plan.DecisionKey,
            Actions =
            [
                new FeatBitAction { Type = "ensure_flag", FlagKind = "multi_variant" },
                new FeatBitAction { Type = "ensure_variants", Variants = plan.Variants },
                new FeatBitAction { Type = "set_rollout", Percentage = plan.RolloutPercentage }
            ]
        };
}
