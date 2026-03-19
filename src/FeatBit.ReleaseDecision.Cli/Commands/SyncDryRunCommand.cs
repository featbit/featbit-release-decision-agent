using System.Text.Json;
using FeatBit.ReleaseDecision.Cli.Engine;
using FeatBit.ReleaseDecision.Cli.Models;
using FeatBit.ReleaseDecision.Cli.Serialization;

namespace FeatBit.ReleaseDecision.Cli.Commands;

public static class SyncDryRunCommand
{
    public static async Task<int> RunAsync(
        string? planPath,
        string? outPath,
        TextWriter stdout,
        TextWriter stderr)
    {
        if (string.IsNullOrWhiteSpace(planPath)) { await stderr.WriteLineAsync("error: --plan is required"); return 1; }
        if (string.IsNullOrWhiteSpace(outPath))  { await stderr.WriteLineAsync("error: --out is required");  return 1; }
        if (!File.Exists(planPath)) { await stderr.WriteLineAsync($"error: plan file not found: {planPath}"); return 1; }

        PlanJson plan;
        try
        {
            plan = JsonSerializer.Deserialize(
                       await File.ReadAllTextAsync(planPath), AppJsonContext.Default.PlanJson)
                   ?? throw new InvalidOperationException("plan.json deserialized to null");
        }
        catch (Exception ex) { await stderr.WriteLineAsync($"error reading plan: {ex.Message}"); return 1; }

        var actions = ActionsDeriving.Derive(plan);
        await File.WriteAllTextAsync(outPath,
            JsonSerializer.Serialize(actions, AppJsonContext.Default.FeatBitActionsJson));

        await stdout.WriteLineAsync($"featbit-actions written to: {outPath}");
        await stdout.WriteLineAsync($"actions ({actions.Actions.Length}):");
        foreach (var action in actions.Actions)
            await stdout.WriteLineAsync($"  - {action.Type}");
        return 0;
    }
}
