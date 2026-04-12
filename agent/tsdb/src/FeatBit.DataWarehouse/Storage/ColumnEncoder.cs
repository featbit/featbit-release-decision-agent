using System.Buffers;
using System.Buffers.Binary;
using System.IO.Compression;
using System.Text;

namespace FeatBit.DataWarehouse.Storage;

/// <summary>
/// Encodes and decodes individual column data blocks.
///
/// Each Encode* method returns a Brotli-compressed byte array ready to be
/// written directly into the segment file.  Decode* is the symmetric inverse.
///
/// Encoding strategies by type:
///   Timestamp      — delta encode (first value absolute, rest forward-deltas),
///                    pack as little-endian int64[], Brotli compress.
///   String         — build a string dictionary; store (dict + int32[] indices), Brotli.
///   NullableString — null bitmap + same as String (nulls get index = int.MinValue).
///   NullableDouble — null bitmap + raw double[] for non-null values, Brotli.
///   Byte           — raw byte[], Brotli.
/// </summary>
internal static class ColumnEncoder
{
    // ── Timestamps ────────────────────────────────────────────────────────────

    public static byte[] EncodeTimestamps(long[] values)
    {
        if (values.Length == 0) return [];

        var raw = new byte[values.Length * sizeof(long)];
        var span = raw.AsSpan();

        // First value is absolute; rest are forward deltas.
        BinaryPrimitives.WriteInt64LittleEndian(span, values[0]);
        for (int i = 1; i < values.Length; i++)
            BinaryPrimitives.WriteInt64LittleEndian(span[(i * 8)..], values[i] - values[i - 1]);

        return BrotliCompress(raw);
    }

    public static long[] DecodeTimestamps(byte[] compressed, int count)
    {
        var raw    = BrotliDecompress(compressed, count * sizeof(long));
        var result = new long[count];
        long prev  = 0;

        for (int i = 0; i < count; i++)
        {
            prev      += BinaryPrimitives.ReadInt64LittleEndian(raw.AsSpan(i * 8));
            result[i]  = prev;
        }

        return result;
    }

    // ── Strings (non-nullable) ────────────────────────────────────────────────

    /// <returns>Compressed column bytes and an optional bloom filter (pass buildBloom=true for indexed columns).</returns>
    public static (byte[] Encoded, BloomFilter? Bloom) EncodeStrings(
        string[] values, bool buildBloom = false)
    {
        var (dict, dictList, indices) = BuildDictionary(values);

        var bloom = buildBloom ? BuildBloom(values) : null;

        return (BrotliCompress(SerializeDictEncoded(dictList, indices, nullBitmap: null)), bloom);
    }

    public static string[] DecodeStrings(byte[] compressed, int count)
    {
        var raw  = BrotliDecompress(compressed, 0);
        using var br = new BinaryReader(new MemoryStream(raw), Encoding.UTF8, leaveOpen: false);

        var dict = ReadDict(br);
        var result = new string[count];
        for (int i = 0; i < count; i++)
            result[i] = dict[br.ReadInt32()];

        return result;
    }

    // ── Nullable strings ──────────────────────────────────────────────────────

    public static (byte[] Encoded, BloomFilter? Bloom) EncodeNullableStrings(
        string?[] values, bool buildBloom = false)
    {
        var (nullBitmap, nonNulls) = BuildNullBitmap(values);
        var (_, dictList, indices) = BuildDictionary(nonNullValues: values, nullable: true);

        var bloom = buildBloom && nonNulls.Count > 0
            ? BuildBloom(nonNulls)
            : null;

        return (BrotliCompress(SerializeDictEncoded(dictList, indices, nullBitmap)), bloom);
    }

    public static string?[] DecodeNullableStrings(byte[] compressed, int count)
    {
        var raw = BrotliDecompress(compressed, 0);
        using var br = new BinaryReader(new MemoryStream(raw), Encoding.UTF8, leaveOpen: false);

        var bitmap    = ReadNullBitmap(br);
        var dict      = ReadDict(br);
        var result    = new string?[count];

        for (int i = 0; i < count; i++)
        {
            var idx = br.ReadInt32();
            result[i] = idx == int.MinValue ? null : dict[idx];
        }

        return result;
    }

    // ── Nullable doubles ──────────────────────────────────────────────────────

    public static byte[] EncodeNullableDoubles(double?[] values)
    {
        var bitmapLen = (values.Length + 7) / 8;
        var bitmap    = new byte[bitmapLen];
        var nonNulls  = new List<double>(values.Length);

        for (int i = 0; i < values.Length; i++)
        {
            if (!values[i].HasValue)
                bitmap[i >> 3] |= (byte)(1 << (i & 7));
            else
                nonNulls.Add(values[i]!.Value);
        }

        using var ms = new MemoryStream();
        using var bw = new BinaryWriter(ms, Encoding.UTF8, leaveOpen: true);

        bw.Write(bitmapLen);
        bw.Write(bitmap);
        bw.Write(nonNulls.Count);
        foreach (var d in nonNulls) bw.Write(d);
        bw.Flush();

        return BrotliCompress(ms.ToArray());
    }

    public static double?[] DecodeNullableDoubles(byte[] compressed, int count)
    {
        var raw = BrotliDecompress(compressed, 0);
        using var br = new BinaryReader(new MemoryStream(raw), Encoding.UTF8, leaveOpen: false);

        var bitmapLen   = br.ReadInt32();
        var bitmap      = br.ReadBytes(bitmapLen);
        var nonNullCount = br.ReadInt32();
        var nonNulls    = new double[nonNullCount];
        for (int i = 0; i < nonNullCount; i++) nonNulls[i] = br.ReadDouble();

        var result      = new double?[count];
        int nonNullIdx  = 0;
        for (int i = 0; i < count; i++)
            result[i] = (bitmap[i >> 3] & (1 << (i & 7))) != 0
                ? null
                : nonNulls[nonNullIdx++];

        return result;
    }

    // ── Raw bytes ─────────────────────────────────────────────────────────────

    public static byte[]  EncodeBytes(byte[] values)                  => BrotliCompress(values);
    public static byte[]  DecodeBytes(byte[] compressed, int count)   => BrotliDecompress(compressed, count);

    // ── Brotli helpers ────────────────────────────────────────────────────────

    internal static byte[] BrotliCompress(byte[] data)
    {
        if (data.Length == 0) return [];

        var maxLen = BrotliEncoder.GetMaxCompressedLength(data.Length);
        var buf    = new byte[maxLen];

        // Quality 4 = fast compression, good ratio for time-series columns.
        if (!BrotliEncoder.TryCompress(data, buf, out var written, quality: 4, window: 22))
            throw new InvalidOperationException("BrotliEncoder.TryCompress returned false.");

        return buf[..written];
    }

    internal static byte[] BrotliDecompress(byte[] compressed, int expectedSize)
    {
        if (compressed.Length == 0) return [];

        // Start with expectedSize (if known) or 4× compressed size; double on DestinationTooSmall.
        var bufSize = expectedSize > 0 ? expectedSize : compressed.Length * 4;

        while (true)
        {
            var buf     = new byte[bufSize];
            bool ok     = BrotliDecoder.TryDecompress(compressed, buf, out var written);

            if (ok) return buf[..written];

            // Buffer too small — double and retry.
            bufSize = checked(bufSize * 2);
            if (bufSize > 512 * 1024 * 1024)
                throw new InvalidDataException("Decompressed column exceeds 512 MB or data is invalid.");
        }
    }

    // ── Private helpers ───────────────────────────────────────────────────────

    /// <summary>
    /// Build a string dictionary.  For nullable callers, pass nullable=true and use the
    /// overload that accepts string?[]; nulls receive index = int.MinValue.
    /// </summary>
    private static (Dictionary<string, int> Dict, List<string> DictList, int[] Indices)
        BuildDictionary(string[] values)
    {
        var dict     = new Dictionary<string, int>(values.Length);
        var dictList = new List<string>(values.Length);
        var indices  = new int[values.Length];

        for (int i = 0; i < values.Length; i++)
        {
            var s = values[i];
            if (!dict.TryGetValue(s, out var idx))
            {
                idx      = dictList.Count;
                dict[s]  = idx;
                dictList.Add(s);
            }
            indices[i] = idx;
        }

        return (dict, dictList, indices);
    }

    private static (Dictionary<string, int> Dict, List<string> DictList, int[] Indices)
        BuildDictionary(string?[] nonNullValues, bool nullable)
    {
        var dict     = new Dictionary<string, int>();
        var dictList = new List<string>();
        var indices  = new int[nonNullValues.Length];

        for (int i = 0; i < nonNullValues.Length; i++)
        {
            var s = nonNullValues[i];
            if (s is null)
            {
                indices[i] = int.MinValue; // null sentinel
                continue;
            }
            if (!dict.TryGetValue(s, out var idx))
            {
                idx     = dictList.Count;
                dict[s] = idx;
                dictList.Add(s);
            }
            indices[i] = idx;
        }

        return (dict, dictList, indices);
    }

    private static (byte[] Bitmap, List<string> NonNulls) BuildNullBitmap(string?[] values)
    {
        var bitmap   = new byte[(values.Length + 7) / 8];
        var nonNulls = new List<string>(values.Length);

        for (int i = 0; i < values.Length; i++)
        {
            if (values[i] is null)
                bitmap[i >> 3] |= (byte)(1 << (i & 7));
            else
                nonNulls.Add(values[i]!);
        }

        return (bitmap, nonNulls);
    }

    private static byte[] SerializeDictEncoded(List<string> dictList, int[] indices, byte[]? nullBitmap)
    {
        using var ms = new MemoryStream();
        using var bw = new BinaryWriter(ms, Encoding.UTF8, leaveOpen: true);

        // Null bitmap (only for nullable columns)
        if (nullBitmap is not null)
        {
            bw.Write(nullBitmap.Length);
            bw.Write(nullBitmap);
        }

        // Dictionary
        bw.Write(dictList.Count);
        foreach (var s in dictList)
        {
            var bytes = Encoding.UTF8.GetBytes(s);
            bw.Write(bytes.Length);
            bw.Write(bytes);
        }

        // Indices (int.MinValue = null sentinel for nullable columns)
        foreach (var idx in indices)
            bw.Write(idx);

        bw.Flush();
        return ms.ToArray();
    }

    private static string[] ReadDict(BinaryReader br)
    {
        var count = br.ReadInt32();
        var dict  = new string[count];
        for (int i = 0; i < count; i++)
        {
            var len   = br.ReadInt32();
            var bytes = br.ReadBytes(len);
            dict[i]   = Encoding.UTF8.GetString(bytes);
        }
        return dict;
    }

    private static byte[] ReadNullBitmap(BinaryReader br)
    {
        var len = br.ReadInt32();
        return br.ReadBytes(len);
    }

    private static BloomFilter BuildBloom(IEnumerable<string> values)
    {
        var list  = values as ICollection<string> ?? values.ToList();
        var bloom = new BloomFilter(list.Count);
        foreach (var s in list) bloom.Add(s);
        return bloom;
    }

    private static BloomFilter BuildBloom(List<string> values)
    {
        var bloom = new BloomFilter(values.Count);
        foreach (var s in values) bloom.Add(s);
        return bloom;
    }
}
