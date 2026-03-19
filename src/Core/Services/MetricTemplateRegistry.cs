namespace Core.Services;

public sealed class MetricTemplateRegistry
{
    private static readonly IReadOnlyDictionary<string, string> PostgresTemplates = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase)
    {
        ["task_success_rate"] = "task_success_rate.postgres.sql",
        ["avg_cost"] = "avg_cost.postgres.sql",
        ["p95_latency_ms"] = "p95_latency_ms.postgres.sql"
    };

    public bool IsSupported(string metricName) => PostgresTemplates.ContainsKey(metricName);

    public bool IsSupported(string dataSourceKind, string metricName)
    {
        return GetTemplatesForDataSourceKind(dataSourceKind).ContainsKey(metricName);
    }

    public string GetTemplateFileName(string dataSourceKind, string metricName)
    {
        var templates = GetTemplatesForDataSourceKind(dataSourceKind);
        return templates.TryGetValue(metricName, out var fileName)
            ? fileName
            : throw new InvalidOperationException($"Unsupported metric '{metricName}' for data source kind '{dataSourceKind}'.");
    }

    private static IReadOnlyDictionary<string, string> GetTemplatesForDataSourceKind(string dataSourceKind)
    {
        return dataSourceKind.ToLowerInvariant() switch
        {
            "postgres" => PostgresTemplates,
            _ => throw new InvalidOperationException($"Unsupported data source kind '{dataSourceKind}'.")
        };
    }
}
