using Core.Models;
using Core.Services;

namespace DecisionCli.Commands;

public sealed class SyncDryRunCommand : ICommandHandler
{
    private readonly FileStore fileStore;

    public SyncDryRunCommand(FileStore fileStore)
    {
        this.fileStore = fileStore;
    }

    public string Name => "sync-dry-run";

    public async Task<int> ExecuteAsync(IReadOnlyDictionary<string, string> options, CancellationToken cancellationToken = default)
    {
        var planPath = GetRequiredOption(options, "plan");
        var outputPath = GetRequiredOption(options, "out");

        ExperimentPlan plan = await fileStore.ReadJsonAsync<ExperimentPlan>(planPath, cancellationToken);
        var actionPlan = new FeatBitActionPlan
        {
            DecisionKey = plan.DecisionKey,
            Actions =
            [
                new FeatBitAction { Type = "ensure_flag", FlagKind = "multi_variant" },
                new FeatBitAction { Type = "ensure_variants", Variants = plan.Variants },
                new FeatBitAction { Type = "set_rollout", Percentage = plan.RolloutPercentage }
            ]
        };

        await fileStore.WriteJsonAsync(outputPath, actionPlan, cancellationToken);
        return 0;
    }

    private static string GetRequiredOption(IReadOnlyDictionary<string, string> options, string name)
    {
        return options.TryGetValue(name, out var value) && !string.IsNullOrWhiteSpace(value)
            ? value
            : throw new InvalidOperationException($"Missing required option --{name}.");
    }
}
