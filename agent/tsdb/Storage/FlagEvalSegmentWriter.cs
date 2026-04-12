using System.Buffers.Binary;
using System.Text.Json;
using FRD.Tsdb.Models;

namespace FRD.Tsdb.Storage;

/// <summary>
/// Writes a batch of <see cref="FlagEvalRecord"/>s to a single immutable segment file (.fbs).
///
/// File layout:
///   [4B]  Magic "FBDW"
///   [1B]  Version
///   [4B]  Header JSON length (int32 LE)
///   [NB]  Header JSON (UTF-8, see SegmentHeader)
///   [...]  Column data blocks (Brotli-compressed, at relative offsets from header end)
///
/// Column order:  timestamp | user_key | variant | experiment_id
///                layer_id  | session_id | hash_bucket | user_props
/// </summary>
internal static class FlagEvalSegmentWriter
{
    public static async Task WriteAsync(
        IReadOnlyList<FlagEvalRecord> records,
        string filePath,
        CancellationToken ct = default)
    {
        int count = records.Count;
        if (count == 0) return;

        // ── 1. Extract column arrays ───────────────────────────────────────────
        var timestamps    = new long[count];
        var userKeys      = new string[count];
        var variants      = new string[count];
        var experimentIds = new string?[count];
        var layerIds      = new string?[count];
        var sessionIds    = new string?[count];
        var hashBuckets   = new byte[count];
        var userProps     = new string?[count];

        for (int i = 0; i < count; i++)
        {
            var r         = records[i];
            timestamps[i]    = r.Timestamp;
            userKeys[i]      = r.UserKey;
            variants[i]      = r.Variant;
            experimentIds[i] = r.ExperimentId;
            layerIds[i]      = r.LayerId;
            sessionIds[i]    = r.SessionId;
            hashBuckets[i]   = r.HashBucket;
            userProps[i]     = r.UserPropsJson;
        }

        // ── 2. Encode columns (in parallel — encoding is CPU-bound) ───────────
        byte[] tsEncoded, ukEncoded, varEncoded, expEncoded,
               layerEncoded, sessionEncoded, hbEncoded, propsEncoded;
        BloomFilter? ukBloom, varBloom, expBloom;

        // Parallelise the heavier encode calls.
        var tasks = new Task[]
        {
            Task.Run(() => tsEncoded       = ColumnEncoder.EncodeTimestamps(timestamps),          ct),
            Task.Run(() => (ukEncoded,      ukBloom)  = ColumnEncoder.EncodeStrings(userKeys,         buildBloom: true),  ct),
            Task.Run(() => (varEncoded,     varBloom)  = ColumnEncoder.EncodeStrings(variants,         buildBloom: true),  ct),
            Task.Run(() => (expEncoded,     expBloom)  = ColumnEncoder.EncodeNullableStrings(experimentIds, buildBloom: true),  ct),
            Task.Run(() => (layerEncoded,   _)         = ColumnEncoder.EncodeNullableStrings(layerIds,   buildBloom: false), ct),
            Task.Run(() => (sessionEncoded, _)         = ColumnEncoder.EncodeNullableStrings(sessionIds, buildBloom: false), ct),
            Task.Run(() => hbEncoded       = ColumnEncoder.EncodeBytes(hashBuckets),              ct),
            Task.Run(() => (propsEncoded,   _)         = ColumnEncoder.EncodeNullableStrings(userProps,  buildBloom: false), ct),
        };

        // Use locals to satisfy the compiler — tasks capture by ref via closures.
        tsEncoded = ukEncoded = varEncoded = expEncoded
            = layerEncoded = sessionEncoded = hbEncoded = propsEncoded = [];
        ukBloom = varBloom = expBloom = null;

        // Run all encoding in parallel
        (tsEncoded, (ukEncoded, ukBloom), (varEncoded, varBloom), (expEncoded, expBloom),
         (layerEncoded, _), (sessionEncoded, _), hbEncoded, (propsEncoded, _)) = await EncodeAllAsync(
            timestamps, userKeys, variants, experimentIds,
            layerIds, sessionIds, hashBuckets, userProps, ct);

        // ── 3. Compute zone map ───────────────────────────────────────────────
        long zoneMin = timestamps[0], zoneMax = timestamps[0];
        foreach (var t in timestamps.AsSpan())
        {
            if (t < zoneMin) zoneMin = t;
            if (t > zoneMax) zoneMax = t;
        }

        // ── 4. Build column metadata with relative offsets ────────────────────
        var columnData = new[] { tsEncoded, ukEncoded, varEncoded, expEncoded,
                                  layerEncoded, sessionEncoded, hbEncoded, propsEncoded };

        var columns = BuildColumnMetas(columnData, zoneMin, zoneMax, ukBloom, varBloom, expBloom);

        var header = new SegmentHeader
        {
            RowCount  = count,
            TableType = TableType.FlagEval,
            CreatedAt = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds(),
            ZoneMin   = zoneMin,
            ZoneMax   = zoneMax,
            Columns   = columns,
        };

        // ── 5. Write to a temp file, then atomic-rename ───────────────────────
        var tmpPath = filePath + ".tmp";
        await WriteSegmentFileAsync(tmpPath, header, columnData, ct);
        File.Move(tmpPath, filePath, overwrite: false);
    }

    // ── Helpers ───────────────────────────────────────────────────────────────

    private static async Task<(
        byte[] ts,
        (byte[] enc, BloomFilter? bloom) uk,
        (byte[] enc, BloomFilter? bloom) var,
        (byte[] enc, BloomFilter? bloom) exp,
        (byte[] enc, BloomFilter? bloom) layer,
        (byte[] enc, BloomFilter? bloom) session,
        byte[] hb,
        (byte[] enc, BloomFilter? bloom) props)>
    EncodeAllAsync(
        long[] timestamps, string[] userKeys, string[] variants, string?[] experimentIds,
        string?[] layerIds, string?[] sessionIds, byte[] hashBuckets, string?[] userProps,
        CancellationToken ct)
    {
        var tsTask      = Task.Run(() => ColumnEncoder.EncodeTimestamps(timestamps), ct);
        var ukTask      = Task.Run(() => ColumnEncoder.EncodeStrings(userKeys,            buildBloom: true),  ct);
        var varTask     = Task.Run(() => ColumnEncoder.EncodeStrings(variants,            buildBloom: true),  ct);
        var expTask     = Task.Run(() => ColumnEncoder.EncodeNullableStrings(experimentIds, buildBloom: true),  ct);
        var layerTask   = Task.Run(() => ColumnEncoder.EncodeNullableStrings(layerIds,    buildBloom: false), ct);
        var sessionTask = Task.Run(() => ColumnEncoder.EncodeNullableStrings(sessionIds,  buildBloom: false), ct);
        var hbTask      = Task.Run(() => ColumnEncoder.EncodeBytes(hashBuckets), ct);
        var propsTask   = Task.Run(() => ColumnEncoder.EncodeNullableStrings(userProps,   buildBloom: false), ct);

        await Task.WhenAll(tsTask, ukTask, varTask, expTask, layerTask, sessionTask, hbTask, propsTask);

        return (tsTask.Result, ukTask.Result, varTask.Result, expTask.Result,
                layerTask.Result, sessionTask.Result, hbTask.Result, propsTask.Result);
    }

    private static List<ColumnMeta> BuildColumnMetas(
        byte[][] columnData, long zoneMin, long zoneMax,
        BloomFilter? ukBloom, BloomFilter? varBloom, BloomFilter? expBloom)
    {
        var names     = new[] { "timestamp", "user_key", "variant", "experiment_id",
                                "layer_id", "session_id", "hash_bucket", "user_props" };
        var dataTypes = new[] { ColumnDataType.Timestamp, ColumnDataType.String, ColumnDataType.String,
                                ColumnDataType.NullableString, ColumnDataType.NullableString,
                                ColumnDataType.NullableString, ColumnDataType.Byte, ColumnDataType.NullableString };
        var blooms    = new[] { (BloomFilter?)null, ukBloom, varBloom, expBloom, null, null, null, null };

        var columns = new List<ColumnMeta>(names.Length);
        long relOffset = 0;

        for (int i = 0; i < names.Length; i++)
        {
            var cm = new ColumnMeta
            {
                Name          = names[i],
                DataType      = dataTypes[i],
                Offset        = relOffset,
                CompressedLen = columnData[i].Length,
            };

            if (dataTypes[i] == ColumnDataType.Timestamp)
            {
                cm.ZoneMin = zoneMin;
                cm.ZoneMax = zoneMax;
            }

            if (blooms[i] is not null)
                cm.BloomFilter = Convert.ToBase64String(blooms[i]!.Serialize());

            columns.Add(cm);
            relOffset += columnData[i].Length;
        }

        return columns;
    }

    internal static async Task WriteSegmentFileAsync(
        string path, SegmentHeader header, byte[][] columnData, CancellationToken ct)
    {
        var headerJson = JsonSerializer.SerializeToUtf8Bytes(
            header, SegmentJsonContext.Default.SegmentHeader);

        await using var fs = new FileStream(
            path, FileMode.CreateNew, FileAccess.Write,
            FileShare.None, bufferSize: 65536, FileOptions.Asynchronous);

        // Preamble
        await fs.WriteAsync(SegmentConstants.Magic.ToArray(), ct);
        fs.WriteByte(SegmentConstants.Version);

        // Header length (4B LE) + header JSON
        Span<byte> lenBuf = stackalloc byte[4];
        BinaryPrimitives.WriteInt32LittleEndian(lenBuf, headerJson.Length);
        await fs.WriteAsync(lenBuf.ToArray(), ct);
        await fs.WriteAsync(headerJson, ct);

        // Column data blocks
        foreach (var block in columnData)
            if (block.Length > 0)
                await fs.WriteAsync(block, ct);

        await fs.FlushAsync(ct);
    }
}
