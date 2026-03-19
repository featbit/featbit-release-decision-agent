namespace Core.Services;

public sealed class RecipeCatalog
{
    private readonly IReadOnlyDictionary<string, RecipeDefinition> recipes = new Dictionary<string, RecipeDefinition>(StringComparer.OrdinalIgnoreCase)
    {
        ["agent_variant_comparison"] = new RecipeDefinition(
            RecipeId: "agent_variant_comparison",
            PrimaryMetric: "task_success_rate",
            Guardrails: ["avg_cost", "p95_latency_ms"],
            AllowedDataSourceKinds: ["postgres"],
            RequiredColumns: ["decision_key", "variant", "task_id", "success", "cost", "latency_ms", "created_at"]),
        ["website_conversion_change"] = new RecipeDefinition(
            RecipeId: "website_conversion_change",
            PrimaryMetric: "task_success_rate",
            Guardrails: ["avg_cost", "p95_latency_ms"],
            AllowedDataSourceKinds: ["postgres"],
            RequiredColumns: ["decision_key", "variant", "task_id", "success", "cost", "latency_ms", "created_at"])
    };

    public bool TryGet(string recipeId, out RecipeDefinition recipeDefinition)
    {
        return recipes.TryGetValue(recipeId, out recipeDefinition!);
    }

    public IReadOnlyCollection<string> GetSupportedRecipeIds() => recipes.Keys.ToArray();
}

public sealed record RecipeDefinition(
    string RecipeId,
    string PrimaryMetric,
    IReadOnlyList<string> Guardrails,
    IReadOnlyList<string> AllowedDataSourceKinds,
    IReadOnlyList<string> RequiredColumns);
