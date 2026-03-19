using Core.Models;

namespace Core.Services;

public sealed class PlanValidator
{
    private readonly RecipeCatalog recipeCatalog;
    private readonly MetricTemplateRegistry metricTemplateRegistry;

    public PlanValidator(RecipeCatalog recipeCatalog, MetricTemplateRegistry metricTemplateRegistry)
    {
        this.recipeCatalog = recipeCatalog;
        this.metricTemplateRegistry = metricTemplateRegistry;
    }

    public IReadOnlyList<string> Validate(ExperimentPlan plan, DataCatalog catalog)
    {
        var errors = new List<string>();
        var hasRecipe = recipeCatalog.TryGet(plan.RecipeId, out var recipe);

        if (string.IsNullOrWhiteSpace(plan.RecipeId))
        {
            errors.Add("recipe_id is required.");
        }
        else if (!hasRecipe)
        {
            errors.Add($"recipe_id '{plan.RecipeId}' is not supported.");
        }

        if (string.IsNullOrWhiteSpace(plan.DecisionKey))
        {
            errors.Add("decision_key is required.");
        }

        if (plan.Variants.Count != 2)
        {
            errors.Add("variants must contain exactly two entries.");
        }
        else
        {
            if (plan.Variants.Any(variant => string.IsNullOrWhiteSpace(variant)))
            {
                errors.Add("variants cannot contain empty values.");
            }

            if (string.Equals(plan.Variants[0], plan.Variants[1], StringComparison.OrdinalIgnoreCase))
            {
                errors.Add("variants must be distinct.");
            }
        }

        if (!string.Equals(plan.RandomizationUnit, "task_id", StringComparison.Ordinal))
        {
            errors.Add("randomization_unit must be task_id.");
        }

        if (string.IsNullOrWhiteSpace(plan.DataSourceKind))
        {
            errors.Add("data_source_kind is required.");
        }
        else if (hasRecipe && !recipe!.AllowedDataSourceKinds.Contains(plan.DataSourceKind, StringComparer.OrdinalIgnoreCase))
        {
            errors.Add($"data_source_kind '{plan.DataSourceKind}' is not supported for recipe '{plan.RecipeId}'.");
        }

        if (string.IsNullOrWhiteSpace(plan.Table))
        {
            errors.Add("table is required.");
        }

        if (string.IsNullOrWhiteSpace(plan.TimeRange.Start) || string.IsNullOrWhiteSpace(plan.TimeRange.End))
        {
            errors.Add("time_range.start and time_range.end are required.");
        }
        else if (!DateTimeOffset.TryParse(plan.TimeRange.Start, out var start) || !DateTimeOffset.TryParse(plan.TimeRange.End, out var end) || start >= end)
        {
            errors.Add("time_range must be a valid range and start must be before end.");
        }

        if (plan.RolloutPercentage is < 0 or > 100)
        {
            errors.Add("rollout_percentage must be between 0 and 100.");
        }

        if (hasRecipe && !string.Equals(plan.PrimaryMetric, recipe!.PrimaryMetric, StringComparison.OrdinalIgnoreCase))
        {
            errors.Add($"primary_metric must be '{recipe.PrimaryMetric}' for recipe '{plan.RecipeId}'.");
        }

        if (!metricTemplateRegistry.IsSupported(plan.PrimaryMetric))
        {
            errors.Add($"primary_metric '{plan.PrimaryMetric}' is not supported.");
        }

        if (hasRecipe)
        {
            var expectedGuardrails = recipe!.Guardrails.OrderBy(value => value, StringComparer.OrdinalIgnoreCase).ToArray();
            var actualGuardrails = plan.Guardrails.OrderBy(value => value, StringComparer.OrdinalIgnoreCase).ToArray();
            if (!expectedGuardrails.SequenceEqual(actualGuardrails, StringComparer.OrdinalIgnoreCase))
            {
                errors.Add($"guardrails must match recipe '{plan.RecipeId}'. Expected: {string.Join(", ", recipe.Guardrails)}.");
            }
        }

        foreach (var guardrail in plan.Guardrails)
        {
            if (!metricTemplateRegistry.IsSupported(guardrail))
            {
                errors.Add($"guardrail '{guardrail}' is not supported.");
            }
        }

        if (string.IsNullOrWhiteSpace(catalog.DataSourceKind))
        {
            errors.Add("catalog data_source_kind is required.");
        }

        if (!catalog.Tables.Any(table => string.Equals(table.Name, plan.Table, StringComparison.OrdinalIgnoreCase)))
        {
            errors.Add($"table '{plan.Table}' was not found in the catalog.");
        }
        else if (hasRecipe)
        {
            var table = catalog.Tables.First(item => string.Equals(item.Name, plan.Table, StringComparison.OrdinalIgnoreCase));
            var missingColumns = recipe!.RequiredColumns
                .Where(requiredColumn => !table.Columns.Any(column => string.Equals(column.Name, requiredColumn, StringComparison.OrdinalIgnoreCase)))
                .ToArray();

            if (missingColumns.Length > 0)
            {
                errors.Add($"table '{plan.Table}' is missing required columns: {string.Join(", ", missingColumns)}.");
            }
        }

        if (!string.Equals(catalog.DataSourceKind, plan.DataSourceKind, StringComparison.OrdinalIgnoreCase))
        {
            errors.Add("catalog data_source_kind does not match plan data_source_kind.");
        }

        return errors;
    }
}
