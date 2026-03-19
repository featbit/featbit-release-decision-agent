namespace Core.Models;

public sealed class DataCatalog
{
    public string DataSourceKind { get; set; } = string.Empty;

    public List<TableSchema> Tables { get; set; } = [];

    public List<string> MetricCandidates { get; set; } = [];
}

public sealed class TableSchema
{
    public string Name { get; set; } = string.Empty;

    public List<ColumnSchema> Columns { get; set; } = [];
}

public sealed class ColumnSchema
{
    public string Name { get; set; } = string.Empty;

    public string Type { get; set; } = string.Empty;
}
