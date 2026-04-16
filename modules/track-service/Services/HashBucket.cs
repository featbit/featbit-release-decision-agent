namespace FeatBit.TrackService.Services;

/// <summary>
/// Mirror of cf-worker / SDK side computeHashBucket so a given (userKey,flagKey)
/// always lands in the same 0–99 bucket regardless of which service computed it.
/// </summary>
public static class HashBucket
{
    public static byte Compute(string userKey, string flagKey)
    {
        unchecked
        {
            uint h = 0;
            var s = $"{userKey}:{flagKey}";
            for (int i = 0; i < s.Length; i++)
                h = (uint)(31 * h + s[i]);
            return (byte)(h % 100);
        }
    }
}
