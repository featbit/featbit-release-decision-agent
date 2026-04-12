using System.IO.Hashing;
using System.Text;
using System.Text.Json;

namespace FeatBit.DataWarehouse.Models;

/// <summary>
/// One flag evaluation event (exposure record).
/// Mirrors FlagEvalMessage from the DataServer project.
/// Stored in the flag-evals columnar store, partitioned by (env_id, flag_key, date).
/// </summary>
public sealed class FlagEvalRecord
{
    public required string EnvId { get; init; }
    public required string FlagKey { get; init; }

    /// <summary>The end-user key. Corresponds to UserKey / user_key across the system.</summary>
    public required string UserKey { get; init; }

    /// <summary>The evaluated variant value (e.g. "true", "false", "blue", "control").</summary>
    public required string Variant { get; init; }

    public string? ExperimentId { get; init; }
    public string? LayerId { get; init; }
    public string? SessionId { get; init; }

    /// <summary>Unix milliseconds. Corresponds to EvaluatedAt in FlagEvalMessage.</summary>
    public required long Timestamp { get; init; }

    /// <summary>
    /// Precomputed abs(XxHash3(UserKey + FlagKey)) % 100.
    /// Stored as a raw byte column so traffic-bucket filtering (trafficPercent / trafficOffset)
    /// is a cheap byte comparison at query time — no rehashing needed.
    /// </summary>
    public required byte HashBucket { get; init; }

    /// <summary>
    /// User property snapshot at evaluation time, serialized as a flat JSON object.
    /// e.g. {"plan":"premium","region":"US","device":"mobile"}
    /// Used for audience filtering: eq / neq / in / nin on property keys.
    /// Mirrors the Dictionary&lt;string,string&gt; UserProps in FlagEvalMessage.
    /// </summary>
    public string? UserPropsJson { get; init; }

    /// <summary>
    /// Compute a deterministic, process-stable hash bucket for traffic splitting.
    /// Equivalent to PostgreSQL: abs(hashtext(user_key || flag_key)) % 100
    /// </summary>
    public static byte ComputeHashBucket(ReadOnlySpan<char> userKey, ReadOnlySpan<char> flagKey)
    {
        // Stack-allocate for short keys; heap-allocate for long ones.
        var maxBytes = Encoding.UTF8.GetMaxByteCount(userKey.Length + flagKey.Length);
        Span<byte> buf = maxBytes <= 512 ? stackalloc byte[maxBytes] : new byte[maxBytes];

        int written = Encoding.UTF8.GetBytes(userKey, buf);
        written += Encoding.UTF8.GetBytes(flagKey, buf[written..]);

        ulong hash = XxHash3.HashToUInt64(buf[..written]);
        return (byte)(hash % 100);
    }

    public static FlagEvalRecord Create(
        string envId,
        string flagKey,
        string userKey,
        string variant,
        long timestampMs,
        string? experimentId = null,
        string? layerId = null,
        string? sessionId = null,
        Dictionary<string, string>? userProps = null) => new()
    {
        EnvId = envId,
        FlagKey = flagKey,
        UserKey = userKey,
        Variant = variant,
        Timestamp = timestampMs,
        HashBucket = ComputeHashBucket(userKey, flagKey),
        ExperimentId = experimentId,
        LayerId = layerId,
        SessionId = sessionId,
        UserPropsJson = userProps is { Count: > 0 }
            ? JsonSerializer.Serialize(userProps)
            : null,
    };
}
