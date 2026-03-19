using FeatBit.ReleaseDecision.Cli.Data;
using FeatBit.ReleaseDecision.Cli.Models;

namespace FeatBit.ReleaseDecision.Cli.Engine;

public sealed record ValidationResult(bool IsValid, string[] Errors);

public static class PlanValidator
{
    private static readonly Dictionary<string, RecipeMeta> KnownRecipes =
        new(StringComparer.OrdinalIgnoreCase)
        {
            ["agent_variant_comparison"] = new("task_success_rate", ["avg_cost", "p95_latency_ms"]),
            ["website_conversion_change"] = new("task_success_rate", ["avg_cost", "p95_latency_ms"]),
        };

    public static ValidationResult Validate(PlanJson plan, CatalogJson? catalog)
    {
        var errors = new List<string>();

        // 1. recipe_id must be supported
        KnownRecipes.TryGetValue(plan.RecipeId, out var recipe);
        if (recipe == null)
            errors.Add($"recipe_id '{plan.RecipeId}' is not a supported recipe (supported: {string.Join(", ", KnownRecipes.Keys)})");

        // 2. variants must have exactly 2 entries
        if (plan.Variants == null || plan.Variants.Length != 2)
            errors.Add("variants must contain exactly two entries");

        // 3. randomization_unit must be task_id
        if (!string.Equals(plan.RandomizationUnit, "task_id", StringComparison.OrdinalIgnoreCase))
            errors.Add($"randomization_unit must be 'task_id', got '{plan.RandomizationUnit}'");

        // 4. data_source_kind must be postgres
        if (!string.Equals(plan.DataSourceKind, "postgres", StringComparison.OrdinalIgnoreCase))
            errors.Add($"data_source_kind must be 'postgres', got '{plan.DataSourceKind}'");

        // 5. primary_metric must match recipe
        if (recipe != null && !string.Equals(plan.PrimaryMetric, recipe.PrimaryMetric, StringComparison.OrdinalIgnoreCase))
            errors.Add($"primary_metric must be '{recipe.PrimaryMetric}' for recipe '{plan.RecipeId}', got '{plan.PrimaryMetric}'");

        // 6. guardrails must contain all recipe-required guardrails
        if (recipe != null)
        {
            var planGuardrails = plan.Guardrails ?? [];
            var missing = recipe.Guardrails
                .Except(planGuardrails, StringComparer.OrdinalIgnoreCase)
                .ToList();
            if (missing.Count > 0)
                errors.Add($"guardrails missing for recipe '{plan.RecipeId}': {string.Join(", ", missing)}");
        }

        // 7. time_range is required and must be parseable
        if (plan.TimeRange == null
            || string.IsNullOrWhiteSpace(plan.TimeRange.Start)
            || string.IsNullOrWhiteSpace(plan.TimeRange.End))
        {
            errors.Add("time_range with start and end is required");
        }
        else
        {
            if (!DateTime.TryParse(plan.TimeRange.Start, out _))
                errors.Add($"time_range.start is not a valid ISO-8601 date: '{plan.TimeRange.Start}'");
            if (!DateTime.TryParse(plan.TimeRange.End, out _))
                errors.Add($"time_range.end is not a valid ISO-8601 date: '{plan.TimeRange.End}'");
        }

        // 8. table is required
        if (string.IsNullOrWhiteSpace(plan.Table))
            errors.Add("table is required");

        // 9. decision_key is required
        if (string.IsNullOrWhiteSpace(plan.DecisionKey))
            errors.Add("decision_key is required");

        // 9+. Catalog-dependent validations (optional — only when catalog is provided)
        if (catalog != null && !string.IsNullOrWhiteSpace(plan.Table))
        {
            var tableEntry = catalog.Tables.FirstOrDefault(
                t => t.Name.Equals(plan.Table, StringComparison.OrdinalIgnoreCase));

            if (tableEntry == null)
            {
                errors.Add($"table '{plan.Table}' not found in catalog");
            }
            else
            {
                var available = tableEntry.Columns.Select(c => c.Name).ToArray();

                // All canonical columns the engine needs must be resolvable
                foreach (var canonical in new[] { "decision_key", "task_id", "variant", "success", "cost", "latency_ms", "timestamp" })
                {
                    if (!ColumnResolver.TryResolve(canonical, plan.ColumnMappings, available, out _))
                        errors.Add(
                            $"canonical column '{canonical}' cannot be resolved in table '{plan.Table}'" +
                            " — add a column_mappings entry");
                }

                // column_mappings values must exist as actual columns
                if (plan.ColumnMappings != null)
                {
                    foreach (var kv in plan.ColumnMappings)
                    {
                        if (!available.Contains(kv.Value, StringComparer.OrdinalIgnoreCase))
                            errors.Add(
                                $"column_mappings['{kv.Key}'] = '{kv.Value}'" +
                                $" not found in table '{plan.Table}'");
                    }
                }
            }
        }

        return new ValidationResult(errors.Count == 0, [.. errors]);
    }

    private sealed record RecipeMeta(string PrimaryMetric, string[] Guardrails);
}
