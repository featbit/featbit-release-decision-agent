using System.Text.Json;
using System.Text.Json.Serialization;

namespace FeatBit.RollupService.Models;

// ── Rollup format (matches TypeScript types exactly) ─────────────────────────

/// <summary>
/// FlagEval rollup file: { "v": 1, "u": { [userKey]: FlagEvalEntry } }
/// FlagEvalEntry is a JSON array: [timestamp, variant, experimentId|null, layerId|null, hashBucket]
/// </summary>
public class FlagEvalRollup
{
    [JsonPropertyName("v")] public int Version { get; set; } = 1;
    [JsonPropertyName("u")] public Dictionary<string, JsonElement> U { get; set; } = [];
}

/// <summary>
/// MetricEvent rollup file: { "v": 1, "u": { [userKey]: MetricEntry } }
/// MetricEntry is a JSON array: [hasConv(0|1), firstTs, firstVal|null, latestTs, latestVal|null, sum, count]
/// </summary>
public class MetricEventRollup
{
    [JsonPropertyName("v")] public int Version { get; set; } = 1;
    [JsonPropertyName("u")] public Dictionary<string, JsonElement> U { get; set; } = [];
}

// ── Delta format (written by PartitionWriterDO) ───────────────────────────────

public class DeltaFile
{
    [JsonPropertyName("v")] public int Version { get; set; }
    [JsonPropertyName("u")] public Dictionary<string, JsonElement> U { get; set; } = [];
}

// ── Mutable accumulator for MetricEntry merge ─────────────────────────────────

public class MetricAcc
{
    public bool    HasConversion { get; set; }
    public long    FirstTs       { get; set; }
    public double? FirstVal      { get; set; }
    public long    LatestTs      { get; set; }
    public double? LatestVal     { get; set; }
    public double  Sum           { get; set; }
    public int     Count         { get; set; }

    /// <summary>Parse from a JSON array element [hasConv, firstTs, firstVal?, latestTs, latestVal?, sum, count]</summary>
    public static MetricAcc FromJsonElement(JsonElement e)
    {
        var a = e.EnumerateArray().ToArray();
        return new MetricAcc
        {
            HasConversion = a[0].GetInt32() == 1,
            FirstTs       = a[1].GetInt64(),
            FirstVal      = a[2].ValueKind == JsonValueKind.Null ? null : a[2].GetDouble(),
            LatestTs      = a[3].GetInt64(),
            LatestVal     = a[4].ValueKind == JsonValueKind.Null ? null : a[4].GetDouble(),
            Sum           = a[5].GetDouble(),
            Count         = a[6].GetInt32(),
        };
    }

    public void Merge(MetricAcc other)
    {
        HasConversion = HasConversion || other.HasConversion;
        if (other.FirstTs < FirstTs)   { FirstTs = other.FirstTs;   FirstVal = other.FirstVal; }
        if (other.LatestTs > LatestTs) { LatestTs = other.LatestTs; LatestVal = other.LatestVal; }
        Sum   += other.Sum;
        Count += other.Count;
    }

    /// <summary>Serialize to JSON array format matching TypeScript MetricEntry</summary>
    public void WriteTo(Utf8JsonWriter w)
    {
        w.WriteStartArray();
        w.WriteNumberValue(HasConversion ? 1 : 0);
        w.WriteNumberValue(FirstTs);
        if (FirstVal.HasValue) w.WriteNumberValue(FirstVal.Value); else w.WriteNullValue();
        w.WriteNumberValue(LatestTs);
        if (LatestVal.HasValue) w.WriteNumberValue(LatestVal.Value); else w.WriteNullValue();
        w.WriteNumberValue(Sum);
        w.WriteNumberValue(Count);
        w.WriteEndArray();
    }
}

// ── R2 config ─────────────────────────────────────────────────────────────────

public class R2Options
{
    public string AccountId   { get; set; } = "";
    public string AccessKeyId { get; set; } = "";
    public string SecretKey   { get; set; } = "";
    public string BucketName  { get; set; } = "featbit-tsdb";
}

// ── Database config ───────────────────────────────────────────────────────────

public class DatabaseOptions
{
    /// <summary>PostgreSQL connection string (Npgsql format). Leave empty to skip DB filtering.</summary>
    public string Url { get; set; } = "";
}
