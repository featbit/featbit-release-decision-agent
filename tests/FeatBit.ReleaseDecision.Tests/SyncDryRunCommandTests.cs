using Core.Models;
using Core.Services;
using DecisionCli.Commands;

namespace FeatBit.ReleaseDecision.Tests;

public sealed class SyncDryRunCommandTests
{
    [Fact]
    public async Task ExecuteAsync_WritesDryRunActions_FromPlan()
    {
        var fileStore = new FileStore();
        var command = new SyncDryRunCommand(fileStore);
        var workingDirectory = Path.Combine(Path.GetTempPath(), "featbit-release-decision-tests", Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(workingDirectory);

        try
        {
            var planPath = Path.Combine(workingDirectory, "plan.json");
            var outputPath = Path.Combine(workingDirectory, "featbit-actions.json");

            await fileStore.WriteJsonAsync(planPath, new ExperimentPlan
            {
                RecipeId = "agent_variant_comparison",
                DecisionKey = "coding_agent_planner",
                Variants = ["planner_a", "planner_b"],
                RandomizationUnit = "task_id",
                PrimaryMetric = "task_success_rate",
                Guardrails = ["avg_cost", "p95_latency_ms"],
                RolloutPercentage = 10,
                DataSourceKind = "postgres",
                Table = "public.decision_events",
                TimeRange = new TimeRange
                {
                    Start = "2026-03-01T00:00:00Z",
                    End = "2026-03-07T00:00:00Z"
                }
            });

            var exitCode = await command.ExecuteAsync(new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase)
            {
                ["plan"] = planPath,
                ["out"] = outputPath
            });

            var actionPlan = await fileStore.ReadJsonAsync<FeatBitActionPlan>(outputPath);

            Assert.Equal(0, exitCode);
            Assert.Equal("coding_agent_planner", actionPlan.DecisionKey);
            Assert.Collection(actionPlan.Actions,
                action =>
                {
                    Assert.Equal("ensure_flag", action.Type);
                    Assert.Equal("multi_variant", action.FlagKind);
                },
                action =>
                {
                    Assert.Equal("ensure_variants", action.Type);
                    Assert.Equal(["planner_a", "planner_b"], action.Variants);
                },
                action =>
                {
                    Assert.Equal("set_rollout", action.Type);
                    Assert.Equal(10, action.Percentage);
                });
        }
        finally
        {
            if (Directory.Exists(workingDirectory))
            {
                Directory.Delete(workingDirectory, recursive: true);
            }
        }
    }
}