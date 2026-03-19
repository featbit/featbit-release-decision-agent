using System.Text.Json;
using FeatBit.ReleaseDecision.Cli.Engine;
using FeatBit.ReleaseDecision.Cli.Models;
using FeatBit.ReleaseDecision.Cli.Serialization;

namespace FeatBit.ReleaseDecision.Cli.Commands;

public static class ValidatePlanCommand
{
    public static async Task<int> RunAsync(
        string? planPath,
        string? catalogPath,
        TextWriter stdout,
        TextWriter stderr)
    {
        if (string.IsNullOrWhiteSpace(planPath))
        {
            await stderr.WriteLineAsync("error: --plan is required");
            return 1;
        }
        if (!File.Exists(planPath))
        {
            await stderr.WriteLineAsync($"error: plan file not found: {planPath}");
            return 1;
        }

        PlanJson plan;
        try
        {
            var raw = await File.ReadAllTextAsync(planPath);
            plan = JsonSerializer.Deserialize(raw, AppJsonContext.Default.PlanJson)
                   ?? throw new InvalidOperationException("plan.json deserialized to null");
        }
        catch (Exception ex)
        {
            await stderr.WriteLineAsync($"error reading plan: {ex.Message}");
            return 1;
        }

        CatalogJson? catalog = null;
        if (!string.IsNullOrWhiteSpace(catalogPath))
        {
            if (!File.Exists(catalogPath))
            {
                await stderr.WriteLineAsync($"error: catalog file not found: {catalogPath}");
                return 1;
            }
            try
            {
                var raw = await File.ReadAllTextAsync(catalogPath);
                catalog = JsonSerializer.Deserialize(raw, AppJsonContext.Default.CatalogJson);
            }
            catch (Exception ex)
            {
                await stderr.WriteLineAsync($"error reading catalog: {ex.Message}");
                return 1;
            }
        }

        var result = PlanValidator.Validate(plan, catalog);

        if (result.IsValid)
        {
            await stdout.WriteLineAsync("plan is valid");
            return 0;
        }

        await stdout.WriteLineAsync($"plan has {result.Errors.Length} validation error(s):");
        foreach (var error in result.Errors)
            await stdout.WriteLineAsync($"  - {error}");
        return 1;
    }
}
