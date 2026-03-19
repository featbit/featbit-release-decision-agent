using System.Text.Json.Serialization;

namespace FeatBit.ReleaseDecision.Cli.Models;

public sealed class CatalogJson
{
    [JsonPropertyName("data_source_kind")]
    public string DataSourceKind { get; set; } = "postgres";

    [JsonPropertyName("tables")]
    public CatalogTable[] Tables { get; set; } = [];

    [JsonPropertyName("metric_candidates")]
    public string[] MetricCandidates { get; set; } = [];
}

public sealed class CatalogTable
{
    [JsonPropertyName("name")]
    public string Name { get; set; } = "";

    [JsonPropertyName("columns")]
    public CatalogColumn[] Columns { get; set; } = [];
}

public sealed class CatalogColumn
{
    [JsonPropertyName("name")]
    public string Name { get; set; } = "";

    [JsonPropertyName("type")]
    public string Type { get; set; } = "";
}
