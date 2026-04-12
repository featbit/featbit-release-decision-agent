using System.Text.Json.Serialization;

namespace FRD.Tsdb.Storage;

// ── Enums ─────────────────────────────────────────────────────────────────────

internal enum TableType : byte
{
    FlagEval    = 0,
    MetricEvent = 1,
}

internal enum ColumnDataType : byte
{
    /// <summary>long[] — delta encoded, Brotli compressed.</summary>
    Timestamp      = 0,

    /// <summary>string[] — dictionary encoded, Brotli compressed.</summary>
    String         = 1,

    /// <summary>string?[] — null bitmap + dictionary encoded, Brotli compressed.</summary>
    NullableString = 2,

    /// <summary>double?[] — null bitmap + raw doubles (non-null only), Brotli compressed.</summary>
    NullableDouble = 3,

    /// <summary>byte[] — raw, Brotli compressed.</summary>
    Byte           = 4,
}

// ── Header models (serialized as JSON in the file header) ────────────────────

internal sealed class ColumnMeta
{
    public string Name { get; set; } = "";

    public ColumnDataType DataType { get; set; }

    /// <summary>
    /// Byte offset of this column's data block, relative to the start of the data section.
    /// Absolute file position = SegmentConstants.PreambleSize + headerLen + Offset.
    /// </summary>
    public long Offset { get; set; }

    public int CompressedLen { get; set; }

    /// <summary>
    /// Zone map min value (unix ms). Only meaningful for Timestamp columns.
    /// Enables O(1) segment pruning for time-range queries.
    /// </summary>
    public long ZoneMin { get; set; }

    /// <summary>Zone map max value (unix ms). Only meaningful for Timestamp columns.</summary>
    public long ZoneMax { get; set; }

    /// <summary>
    /// Base64-encoded bloom filter bytes. Present on String / NullableString columns
    /// that are flagged for bloom indexing (user_key, variant, experiment_id).
    /// Enables O(1) segment skipping when a filter value is definitely absent.
    /// </summary>
    public string? BloomFilter { get; set; }
}

internal sealed class SegmentHeader
{
    public int       RowCount   { get; set; }
    public TableType TableType  { get; set; }
    public long      CreatedAt  { get; set; }  // unix ms

    /// <summary>Segment-level timestamp zone map — min across all rows.</summary>
    public long ZoneMin { get; set; }

    /// <summary>Segment-level timestamp zone map — max across all rows.</summary>
    public long ZoneMax { get; set; }

    public List<ColumnMeta> Columns { get; set; } = [];
}

// ── JSON source-generation context (AOT-friendly) ────────────────────────────

[JsonSourceGenerationOptions(
    WriteIndented = false,
    PropertyNamingPolicy = JsonKnownNamingPolicy.CamelCase,
    UseStringEnumConverter = true)]
[JsonSerializable(typeof(SegmentHeader))]
[JsonSerializable(typeof(ColumnMeta))]
[JsonSerializable(typeof(List<ColumnMeta>))]
internal sealed partial class SegmentJsonContext : JsonSerializerContext { }

// ── File format constants ─────────────────────────────────────────────────────

internal static class SegmentConstants
{
    /// <summary>Magic bytes: "FBDW" (FeatBit Data Warehouse).</summary>
    public static ReadOnlySpan<byte> Magic => "FBDW"u8;

    public const byte Version = 1;

    public const string FileExtension = ".fbs";

    /// <summary>
    /// Fixed-size preamble before the header JSON:
    ///   4B magic + 1B version + 4B header-length = 9 bytes.
    /// </summary>
    public const int PreambleSize = 9;
}
