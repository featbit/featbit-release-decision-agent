using System.Text.Json.Serialization;

namespace FeatBit.TrackService.Models;

/// <summary>Request body for POST /api/query/experiment.</summary>
public sealed class ExperimentQueryRequest
{
    [JsonPropertyName("envId")]       public string EnvId       { get; set; } = "";
    [JsonPropertyName("flagKey")]     public string FlagKey     { get; set; } = "";
    [JsonPropertyName("metricEvent")] public string MetricEvent { get; set; } = "";
    [JsonPropertyName("startDate")]   public string StartDate   { get; set; } = ""; // YYYY-MM-DD
    [JsonPropertyName("endDate")]     public string EndDate     { get; set; } = ""; // YYYY-MM-DD (inclusive)
}

/// <summary>Per-variant aggregate result, ready to feed into stats-service.</summary>
public sealed class VariantStats
{
    [JsonPropertyName("variant")]     public string Variant     { get; set; } = "";
    [JsonPropertyName("users")]       public long   Users       { get; set; }
    [JsonPropertyName("conversions")] public long   Conversions { get; set; }
    [JsonPropertyName("sumValue")]    public double SumValue    { get; set; }
    [JsonPropertyName("sumSquares")]  public double SumSquares  { get; set; }

    [JsonPropertyName("conversionRate")]
    public double ConversionRate => Users > 0 ? (double)Conversions / Users : 0.0;

    [JsonPropertyName("avgValue")]
    public double AvgValue => Conversions > 0 ? SumValue / Conversions : 0.0;
}

public sealed class ExperimentQueryResponse
{
    [JsonPropertyName("envId")]       public string EnvId       { get; set; } = "";
    [JsonPropertyName("flagKey")]     public string FlagKey     { get; set; } = "";
    [JsonPropertyName("metricEvent")] public string MetricEvent { get; set; } = "";
    [JsonPropertyName("window")]      public WindowInfo Window  { get; set; } = new();
    [JsonPropertyName("variants")]    public List<VariantStats> Variants { get; set; } = new();

    public sealed class WindowInfo
    {
        [JsonPropertyName("start")] public string Start { get; set; } = "";
        [JsonPropertyName("end")]   public string End   { get; set; } = "";
    }
}
