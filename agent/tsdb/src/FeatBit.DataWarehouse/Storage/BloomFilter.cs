using System.IO.Hashing;
using System.Text;

namespace FeatBit.DataWarehouse.Storage;

/// <summary>
/// Simple Bloom filter for string membership testing.
///
/// Uses XxHash3 double-hashing with k=3 probes.
/// For n expected elements at p=1% FPR:  m ≈ 9.6 * n bits.
///
/// Usage: build during segment write, serialize into the column metadata (base64),
/// load at query time to skip segments where a filter value is definitely absent.
/// </summary>
internal sealed class BloomFilter
{
    private readonly byte[] _bits;
    private readonly int    _bitCount;

    private const int K = 3;  // number of hash probes per element

    // ── Constructors ──────────────────────────────────────────────────────────

    /// <summary>Create a new, empty filter sized for <paramref name="expectedElements"/>.</summary>
    public BloomFilter(int expectedElements, double falsePositiveRate = 0.01)
    {
        // m = ceil( -n * ln(p) / (ln 2)^2 )
        int m = (int)Math.Ceiling(-expectedElements * Math.Log(falsePositiveRate)
                                  / (Math.Log(2) * Math.Log(2)));
        m = Math.Max(m, 64);            // at least 8 bytes
        _bitCount = (m + 7) & ~7;       // round up to byte boundary
        _bits = new byte[_bitCount / 8];
    }

    /// <summary>Deserialize a filter previously produced by <see cref="Serialize"/>.</summary>
    public BloomFilter(byte[] serialized)
    {
        _bits     = serialized;
        _bitCount = serialized.Length * 8;
    }

    // ── Public API ────────────────────────────────────────────────────────────

    public void Add(ReadOnlySpan<char> value)
    {
        var (h1, h2) = Hash(value);
        for (int i = 0; i < K; i++)
            SetBit((h1 + (ulong)i * h2) % (ulong)_bitCount);
    }

    public bool MightContain(ReadOnlySpan<char> value)
    {
        var (h1, h2) = Hash(value);
        for (int i = 0; i < K; i++)
            if (!GetBit((h1 + (ulong)i * h2) % (ulong)_bitCount))
                return false;
        return true;
    }

    /// <summary>Returns the raw bit-array — embed as base64 in <see cref="ColumnMeta.BloomFilter"/>.</summary>
    public byte[] Serialize() => _bits;

    // ── Internals ─────────────────────────────────────────────────────────────

    private void SetBit(ulong pos) =>
        _bits[pos >> 3] |= (byte)(1 << (int)(pos & 7));

    private bool GetBit(ulong pos) =>
        (_bits[pos >> 3] & (byte)(1 << (int)(pos & 7))) != 0;

    private static (ulong h1, ulong h2) Hash(ReadOnlySpan<char> value)
    {
        // Stack-allocate UTF-8 bytes for short strings to avoid heap pressure.
        int maxBytes = Encoding.UTF8.GetMaxByteCount(value.Length);
        Span<byte> buf = maxBytes <= 512 ? stackalloc byte[maxBytes] : new byte[maxBytes];

        int len = Encoding.UTF8.GetBytes(value, buf);
        buf = buf[..len];

        ulong h1 = XxHash3.HashToUInt64(buf, seed: 0);
        ulong h2 = XxHash3.HashToUInt64(buf, seed: unchecked((long)0xDEAD_BEEF_CAFE_BABEu));
        return (h1, h2 | 1);  // ensure h2 is odd so it visits all positions
    }
}
