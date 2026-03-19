namespace Core.Services;

public sealed class SqlTemplateLoader
{
    private readonly MetricTemplateRegistry metricTemplateRegistry;

    public SqlTemplateLoader(MetricTemplateRegistry metricTemplateRegistry)
    {
        this.metricTemplateRegistry = metricTemplateRegistry;
    }

    public string Load(string dataSourceKind, string metricName)
    {
        var fileName = metricTemplateRegistry.GetTemplateFileName(dataSourceKind, metricName);
        var path = Path.Combine(AppContext.BaseDirectory, "Templates", "Sql", fileName);

        if (!File.Exists(path))
        {
            throw new InvalidOperationException($"SQL template '{fileName}' was not found at '{path}'.");
        }

        return File.ReadAllText(path);
    }
}