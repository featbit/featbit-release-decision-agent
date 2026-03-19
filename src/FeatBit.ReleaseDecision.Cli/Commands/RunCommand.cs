using System.Text;
using System.Text.Json;
using FeatBit.ReleaseDecision.Cli.Data;
using FeatBit.ReleaseDecision.Cli.Engine;
using FeatBit.ReleaseDecision.Cli.Models;
using FeatBit.ReleaseDecision.Cli.Serialization;

namespace FeatBit.ReleaseDecision.Cli.Commands;

public static class RunCommand
{
    public static async Task<int> RunAsync(
        string? planPath,
        string? catalogPath,
        string? connectionEnv,
        string? outPath,
        string? summaryOutPath,
        TextWriter stdout,
        TextWriter stderr)
    {
        if (string.IsNullOrWhiteSpace(planPath))       { await stderr.WriteLineAsync("error: --plan is required");         return 1; }
        if (string.IsNullOrWhiteSpace(catalogPath))    { await stderr.WriteLineAsync("error: --catalog is required");      return 1; }
        if (string.IsNullOrWhiteSpace(connectionEnv))  { await stderr.WriteLineAsync("error: --connection-env is required"); return 1; }
        if (string.IsNullOrWhiteSpace(outPath))        { await stderr.WriteLineAsync("error: --out is required");          return 1; }
        if (string.IsNullOrWhiteSpace(summaryOutPath)) { await stderr.WriteLineAsync("error: --summary-out is required");  return 1; }

        if (!File.Exists(planPath))    { await stderr.WriteLineAsync($"error: plan file not found: {planPath}");    return 1; }
        if (!File.Exists(catalogPath)) { await stderr.WriteLineAsync($"error: catalog file not found: {catalogPath}"); return 1; }

        var connectionString = Environment.GetEnvironmentVariable(connectionEnv);
        if (string.IsNullOrWhiteSpace(connectionString))
        {
            await stderr.WriteLineAsync($"error: environment variable '{connectionEnv}' is not set or is empty");
            return 1;
        }

        PlanJson plan;
        CatalogJson catalog;
        try
        {
            plan = JsonSerializer.Deserialize(
                       await File.ReadAllTextAsync(planPath), AppJsonContext.Default.PlanJson)
                   ?? throw new InvalidOperationException("plan.json deserialized to null");
            catalog = JsonSerializer.Deserialize(
                          await File.ReadAllTextAsync(catalogPath), AppJsonContext.Default.CatalogJson)
                      ?? throw new InvalidOperationException("catalog.json deserialized to null");
        }
        catch (Exception ex) { await stderr.WriteLineAsync($"error reading inputs: {ex.Message}"); return 1; }

        // Always validate before running
        var validation = PlanValidator.Validate(plan, catalog);
        if (!validation.IsValid)
        {
            await stderr.WriteLineAsync($"error: plan validation failed ({validation.Errors.Length} error(s)):");
            foreach (var e in validation.Errors)
                await stderr.WriteLineAsync($"  - {e}");
            return 1;
        }

        try
        {
            var analyzer = new PostgresAnalyzer(connectionString);
            var metrics = await analyzer.AnalyzeAsync(plan, catalog);
            var results = DecisionPolicy.Apply(plan, metrics);

            await File.WriteAllTextAsync(outPath,
                JsonSerializer.Serialize(results, AppJsonContext.Default.ResultsJson));
            await File.WriteAllTextAsync(summaryOutPath, BuildSummary(plan, results));

            await stdout.WriteLineAsync($"results written to:   {outPath}");
            await stdout.WriteLineAsync($"summary written to:   {summaryOutPath}");
            await stdout.WriteLineAsync($"recommendation:       {results.Recommendation}");
            await stdout.WriteLineAsync($"next rollout:         {results.RecommendedNextRolloutPercentage}%");
            return 0;
        }
        catch (Exception ex) { await stderr.WriteLineAsync($"error: {ex.Message}"); return 1; }
    }

    private static string BuildSummary(PlanJson plan, ResultsJson results)
    {
        var sb = new StringBuilder();
        sb.AppendLine($"# Release Decision: {plan.DecisionKey}");
        sb.AppendLine();
        sb.AppendLine($"**Recipe:** {plan.RecipeId}");
        sb.AppendLine($"**Time range:** {plan.TimeRange.Start} → {plan.TimeRange.End}");
        sb.AppendLine($"**Variants:** `{plan.Variants[0]}` (baseline) vs `{plan.Variants[1]}` (candidate)");
        sb.AppendLine();
        sb.AppendLine("## Primary Metric");
        sb.AppendLine();
        var pm = results.PrimaryMetric;
        sb.AppendLine("| Metric | Baseline | Candidate | Δ abs | Δ rel |");
        sb.AppendLine("|--------|----------|-----------|-------|-------|");
        sb.AppendLine($"| {pm.Name} | {pm.BaselineValue:F4} | {pm.CandidateValue:F4} | {pm.AbsoluteDelta:+0.0000;-0.0000} | {pm.RelativeDelta:+0.00%;-0.00%} |");
        sb.AppendLine();
        sb.AppendLine("## Guardrails");
        sb.AppendLine();
        sb.AppendLine("| Guardrail | Baseline | Candidate | Δ rel | Status |");
        sb.AppendLine("|-----------|----------|-----------|-------|--------|");
        foreach (var g in results.Guardrails)
            sb.AppendLine($"| {g.Name} | {g.BaselineValue:F4} | {g.CandidateValue:F4} | {g.RelativeDelta:+0.00%;-0.00%} | {g.Status} |");
        sb.AppendLine();
        sb.AppendLine("## Decision");
        sb.AppendLine();
        sb.AppendLine($"**Recommendation:** `{results.Recommendation}`");
        sb.AppendLine($"**Next rollout:** {results.RecommendedNextRolloutPercentage}%");
        sb.AppendLine();
        sb.AppendLine("**Reasoning:**");
        foreach (var r in results.Reasoning)
            sb.AppendLine($"- {r}");
        return sb.ToString();
    }
}
