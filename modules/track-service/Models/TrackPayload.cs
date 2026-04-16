using System.Text.Json.Serialization;

namespace FeatBit.TrackService.Models;

/// <summary>
/// SDK-shaped batch payload — same wire format as the old cf-worker /api/track
/// so existing SDKs (and run-active-test-worker) don't have to change a thing.
/// </summary>
public sealed class TrackPayload
{
    [JsonPropertyName("user")]       public TrackUser User { get; set; } = new();
    [JsonPropertyName("variations")] public List<VariationItem>? Variations { get; set; }
    [JsonPropertyName("metrics")]    public List<MetricItem>?    Metrics    { get; set; }
}

public sealed class TrackUser
{
    [JsonPropertyName("keyId")]      public string KeyId { get; set; } = "";
    [JsonPropertyName("properties")] public Dictionary<string, string>? Properties { get; set; }
}

public sealed class VariationItem
{
    [JsonPropertyName("flagKey")]      public string  FlagKey      { get; set; } = "";
    [JsonPropertyName("variant")]      public string  Variant      { get; set; } = "";
    [JsonPropertyName("timestamp")]    public long    Timestamp    { get; set; }   // epoch seconds
    [JsonPropertyName("experimentId")] public string? ExperimentId { get; set; }
    [JsonPropertyName("layerId")]      public string? LayerId      { get; set; }
}

public sealed class MetricItem
{
    [JsonPropertyName("eventName")]    public string  EventName    { get; set; } = "";
    [JsonPropertyName("timestamp")]    public long    Timestamp    { get; set; }   // epoch seconds
    [JsonPropertyName("numericValue")] public double? NumericValue { get; set; }
    [JsonPropertyName("type")]         public string? Type         { get; set; }
}
