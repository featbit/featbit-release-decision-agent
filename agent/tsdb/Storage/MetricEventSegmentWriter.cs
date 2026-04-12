using System.Buffers.Binary;
using System.Text.Json;
using FRD.Tsdb.Models;

namespace FRD.Tsdb.Storage;

/// <summary>
/// Writes a batch of <see cref="MetricEventRecord"/>s to a single immutable segment file.
///
/// Column order:  timestamp | user_key | numeric_value | session_id | source
/// </summary>
internal static class MetricEventSegmentWriter
{
    public static async Task WriteAsync(
        IReadOnlyList<MetricEventRecord> records,
        string filePath,
        CancellationToken ct = default)
    {
        int count = records.Count;
        if (count == 0) return;

        // ── 1. Extract column arrays ───────────────────────────────────────────
        var timestamps     = new long[count];
        var userKeys       = new string[count];
        var numericValues  = new double?[count];
        var sessionIds     = new string?[count];
        var sources        = new string?[count];

        for (int i = 0; i < count; i++)
        {
            var r          = records[i];
            timestamps[i]    = r.Timestamp;
            userKeys[i]      = r.UserKey;
            numericValues[i] = r.NumericValue;
            sessionIds[i]    = r.SessionId;
            sources[i]       = r.Source;
        }

        // ── 2. Encode columns in parallel ─────────────────────────────────────
        var tsTask      = Task.Run(() => ColumnEncoder.EncodeTimestamps(timestamps), ct);
        var ukTask      = Task.Run(() => ColumnEncoder.EncodeStrings(userKeys, buildBloom: true), ct);
        var nvTask      = Task.Run(() => ColumnEncoder.EncodeNullableDoubles(numericValues), ct);
        var sessionTask = Task.Run(() => ColumnEncoder.EncodeNullableStrings(sessionIds, buildBloom: false), ct);
        var sourceTask  = Task.Run(() => ColumnEncoder.EncodeNullableStrings(sources,    buildBloom: false), ct);

        await Task.WhenAll(tsTask, ukTask, nvTask, sessionTask, sourceTask);

        var tsEncoded          = tsTask.Result;
        var (ukEncoded, ukBloom) = ukTask.Result;
        var nvEncoded          = nvTask.Result;
        var (sessionEncoded, _)  = sessionTask.Result;
        var (sourceEncoded, _)   = sourceTask.Result;

        // ── 3. Zone map on timestamp ───────────────────────────────────────────
        long zoneMin = timestamps[0], zoneMax = timestamps[0];
        foreach (var t in timestamps.AsSpan())
        {
            if (t < zoneMin) zoneMin = t;
            if (t > zoneMax) zoneMax = t;
        }

        // ── 4. Column metadata with relative offsets ──────────────────────────
        var columnData = new[] { tsEncoded, ukEncoded, nvEncoded, sessionEncoded, sourceEncoded };

        var names     = new[] { "timestamp", "user_key", "numeric_value", "session_id", "source" };
        var dataTypes = new[] { ColumnDataType.Timestamp, ColumnDataType.String,
                                ColumnDataType.NullableDouble, ColumnDataType.NullableString,
                                ColumnDataType.NullableString };

        var columns   = new List<ColumnMeta>(names.Length);
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

            if (names[i] == "timestamp")   { cm.ZoneMin = zoneMin; cm.ZoneMax = zoneMax; }
            if (names[i] == "user_key" && ukBloom is not null)
                cm.BloomFilter = Convert.ToBase64String(ukBloom.Serialize());

            columns.Add(cm);
            relOffset += columnData[i].Length;
        }

        var header = new SegmentHeader
        {
            RowCount  = count,
            TableType = TableType.MetricEvent,
            CreatedAt = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds(),
            ZoneMin   = zoneMin,
            ZoneMax   = zoneMax,
            Columns   = columns,
        };

        // ── 5. Atomic write ───────────────────────────────────────────────────
        var tmpPath = filePath + ".tmp";
        await FlagEvalSegmentWriter.WriteSegmentFileAsync(tmpPath, header, columnData, ct);
        File.Move(tmpPath, filePath, overwrite: false);
    }
}
