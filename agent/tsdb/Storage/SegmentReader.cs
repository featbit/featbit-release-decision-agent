using System.Buffers.Binary;
using System.Text.Json;
using FRD.Tsdb.Models;

namespace FRD.Tsdb.Storage;

/// <summary>
/// Reads segment files (.fbs) written by <see cref="FlagEvalSegmentWriter"/>
/// or <see cref="MetricEventSegmentWriter"/>.
///
/// All I/O uses <see cref="RandomAccess"/> so multiple concurrent readers can
/// share a single <see cref="SafeFileHandle"/> without seeking conflicts.
/// </summary>
internal static class SegmentReader
{
    // ── Public API ────────────────────────────────────────────────────────────

    /// <summary>
    /// Read file header.  Call this once and cache the result — it's the metadata
    /// needed for zone-map / bloom-filter pruning before reading any column.
    /// Returns the header and the absolute byte offset where column data begins.
    /// </summary>
    public static async Task<(SegmentHeader Header, int DataOffset)> ReadHeaderAsync(
        string filePath, CancellationToken ct = default)
    {
        await using var fs = OpenRead(filePath);

        // Validate magic + version
        var preamble = new byte[SegmentConstants.PreambleSize];
        await fs.ReadExactlyAsync(preamble, ct);

        if (!preamble.AsSpan(0, 4).SequenceEqual(SegmentConstants.Magic))
            throw new InvalidDataException($"Bad magic bytes in {filePath}");

        if (preamble[4] != SegmentConstants.Version)
            throw new InvalidDataException(
                $"Unsupported segment version {preamble[4]} in {filePath}");

        var headerLen = BinaryPrimitives.ReadInt32LittleEndian(preamble.AsSpan(5));
        var headerJson = new byte[headerLen];
        await fs.ReadExactlyAsync(headerJson, ct);

        var header = JsonSerializer.Deserialize(headerJson, SegmentJsonContext.Default.SegmentHeader)
            ?? throw new InvalidDataException($"Failed to deserialize header in {filePath}");

        int dataOffset = SegmentConstants.PreambleSize + headerLen;
        return (header, dataOffset);
    }

    // ── Zone-map and bloom-filter pruning helpers ─────────────────────────────

    /// <summary>
    /// Returns false if the segment cannot contain any rows in [minTs, maxTs].
    /// Enables O(1) segment skipping for time-range queries.
    /// </summary>
    public static bool OverlapsTimeRange(SegmentHeader header, long minTs, long maxTs)
        => header.ZoneMax >= minTs && header.ZoneMin <= maxTs;

    /// <summary>
    /// Returns false if <paramref name="value"/> is definitely absent from
    /// <paramref name="columnName"/> in this segment (bloom filter says no).
    /// Returns true if the value might be present (pass-through to full scan).
    /// </summary>
    public static bool MightContain(SegmentHeader header, string columnName, string value)
    {
        var col = header.Columns.FirstOrDefault(c => c.Name == columnName);
        if (col?.BloomFilter is null) return true;  // no bloom = assume present

        var bloom = new BloomFilter(Convert.FromBase64String(col.BloomFilter));
        return bloom.MightContain(value);
    }

    // ── Full record reconstruction ────────────────────────────────────────────

    /// <summary>Read all <see cref="FlagEvalRecord"/>s from a segment file.</summary>
    public static async Task<List<FlagEvalRecord>> ReadFlagEvalsAsync(
        string filePath, CancellationToken ct = default)
    {
        var (header, dataOffset) = await ReadHeaderAsync(filePath, ct);

        if (header.TableType != TableType.FlagEval)
            throw new InvalidDataException($"{filePath} is not a FlagEval segment.");

        var cols = await ReadAllColumnsAsync(filePath, header, dataOffset, ct);

        var timestamps    = ColumnEncoder.DecodeTimestamps(cols["timestamp"],     header.RowCount);
        var userKeys      = ColumnEncoder.DecodeStrings(cols["user_key"],         header.RowCount);
        var variants      = ColumnEncoder.DecodeStrings(cols["variant"],          header.RowCount);
        var experimentIds = ColumnEncoder.DecodeNullableStrings(cols["experiment_id"], header.RowCount);
        var layerIds      = ColumnEncoder.DecodeNullableStrings(cols["layer_id"],      header.RowCount);
        var sessionIds    = ColumnEncoder.DecodeNullableStrings(cols["session_id"],    header.RowCount);
        var hashBuckets   = ColumnEncoder.DecodeBytes(cols["hash_bucket"],        header.RowCount);
        var userProps     = ColumnEncoder.DecodeNullableStrings(cols["user_props"], header.RowCount);

        var result = new List<FlagEvalRecord>(header.RowCount);
        for (int i = 0; i < header.RowCount; i++)
        {
            result.Add(new FlagEvalRecord
            {
                // EnvId and FlagKey are implicit in the partition path — not stored per-row.
                // Callers must supply them from the partition key when needed.
                EnvId        = "",
                FlagKey      = "",
                UserKey      = userKeys[i],
                Variant      = variants[i],
                Timestamp    = timestamps[i],
                HashBucket   = hashBuckets[i],
                ExperimentId = experimentIds[i],
                LayerId      = layerIds[i],
                SessionId    = sessionIds[i],
                UserPropsJson = userProps[i],
            });
        }

        return result;
    }

    /// <summary>Read all <see cref="MetricEventRecord"/>s from a segment file.</summary>
    public static async Task<List<MetricEventRecord>> ReadMetricEventsAsync(
        string filePath, CancellationToken ct = default)
    {
        var (header, dataOffset) = await ReadHeaderAsync(filePath, ct);

        if (header.TableType != TableType.MetricEvent)
            throw new InvalidDataException($"{filePath} is not a MetricEvent segment.");

        var cols = await ReadAllColumnsAsync(filePath, header, dataOffset, ct);

        var timestamps    = ColumnEncoder.DecodeTimestamps(cols["timestamp"],  header.RowCount);
        var userKeys      = ColumnEncoder.DecodeStrings(cols["user_key"],      header.RowCount);
        var numericValues = ColumnEncoder.DecodeNullableDoubles(cols["numeric_value"], header.RowCount);
        var sessionIds    = ColumnEncoder.DecodeNullableStrings(cols["session_id"],    header.RowCount);
        var sources       = ColumnEncoder.DecodeNullableStrings(cols["source"],        header.RowCount);

        var result = new List<MetricEventRecord>(header.RowCount);
        for (int i = 0; i < header.RowCount; i++)
        {
            result.Add(new MetricEventRecord
            {
                EnvId        = "",
                EventName    = "",
                UserKey      = userKeys[i],
                Timestamp    = timestamps[i],
                NumericValue = numericValues[i],
                SessionId    = sessionIds[i],
                Source       = sources[i],
            });
        }

        return result;
    }

    // ── Low-level column reading ──────────────────────────────────────────────

    /// <summary>
    /// Read one compressed column block from the file.
    /// Uses <see cref="RandomAccess"/> for thread-safe positional I/O.
    /// </summary>
    public static async Task<byte[]> ReadColumnBytesAsync(
        string filePath, SegmentHeader header, string columnName,
        int dataOffset, CancellationToken ct = default)
    {
        var col = header.Columns.FirstOrDefault(c => c.Name == columnName)
            ?? throw new ArgumentException($"Column '{columnName}' not found in segment.");

        if (col.CompressedLen == 0) return [];

        long absoluteOffset = dataOffset + col.Offset;
        var buf = new byte[col.CompressedLen];

        using var handle = File.OpenHandle(filePath, FileMode.Open, FileAccess.Read,
            FileShare.Read, FileOptions.Asynchronous);

        await RandomAccess.ReadAsync(handle, buf.AsMemory(), absoluteOffset, ct);
        return buf;
    }

    // ── Selective column reading (used by query engine) ───────────────────────

    /// <summary>
    /// Read only the columns in <paramref name="columnNames"/> from a segment.
    /// Opens the file once and reads all requested columns in parallel.
    /// Unknown column names are silently ignored.
    /// </summary>
    internal static async Task<Dictionary<string, byte[]>> ReadSelectedColumnsAsync(
        string filePath, SegmentHeader header, int dataOffset,
        IReadOnlySet<string> columnNames, CancellationToken ct)
    {
        using var handle = File.OpenHandle(filePath, FileMode.Open, FileAccess.Read,
            FileShare.Read, FileOptions.Asynchronous);

        var tasks = header.Columns
            .Where(col => columnNames.Contains(col.Name))
            .Select(async col =>
            {
                if (col.CompressedLen == 0) return (col.Name, Data: Array.Empty<byte>());
                var buf = new byte[col.CompressedLen];
                await RandomAccess.ReadAsync(handle, buf.AsMemory(), dataOffset + col.Offset, ct);
                return (col.Name, Data: buf);
            });

        var results = await Task.WhenAll(tasks);
        return results.ToDictionary(r => r.Name, r => r.Data);
    }

    // ── Internals ─────────────────────────────────────────────────────────────

    private static async Task<Dictionary<string, byte[]>> ReadAllColumnsAsync(
        string filePath, SegmentHeader header, int dataOffset, CancellationToken ct)
    {
        // Read all columns in parallel using a single open handle.
        using var handle = File.OpenHandle(filePath, FileMode.Open, FileAccess.Read,
            FileShare.Read, FileOptions.Asynchronous);

        var tasks = header.Columns.Select(async col =>
        {
            if (col.CompressedLen == 0) return (col.Name, Data: Array.Empty<byte>());

            var buf = new byte[col.CompressedLen];
            await RandomAccess.ReadAsync(handle, buf.AsMemory(), dataOffset + col.Offset, ct);
            return (col.Name, Data: buf);
        });

        var results = await Task.WhenAll(tasks);
        return results.ToDictionary(r => r.Name, r => r.Data);
    }

    private static FileStream OpenRead(string path)
        => new(path, FileMode.Open, FileAccess.Read, FileShare.Read,
               bufferSize: 4096, FileOptions.Asynchronous | FileOptions.SequentialScan);
}
