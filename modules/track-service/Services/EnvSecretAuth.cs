using System.Buffers;
using System.Buffers.Text;
using System.Security.Cryptography;
using System.Text;

namespace FeatBit.TrackService.Services;

/// <summary>
/// Config for <see cref="EnvSecretMiddleware"/>.
///
/// Env secret format:  <c>fbes.&lt;b64url(envId)&gt;.&lt;b64url(HMAC-SHA256(envId, SigningKey)[0..16])&gt;</c>
///
/// The middleware reads the <c>Authorization</c> header, parses the envId out
/// of the token, recomputes the HMAC with <see cref="SigningKey"/>, and on
/// success stashes the plain envId in <c>HttpContext.Items["envId"]</c> for
/// downstream handlers. ClickHouse stores the plain envId — tokens are never
/// persisted.
/// </summary>
public sealed class EnvSecretOptions
{
    public const string TokenPrefix    = "fbes.";
    public const string ContextItemKey = "envId";
    public const int    SignatureBytes = 16; // HMAC-SHA256 truncated to 128 bits

    /// <summary>
    /// HMAC key bytes. When <c>null</c>, the middleware falls back to the
    /// legacy "Authorization header = envId" behavior so rolling upgrades and
    /// local dev keep working. A warning is logged at startup.
    /// </summary>
    public byte[]? SigningKey { get; set; }
}

public sealed class EnvSecretMiddleware
{
    private readonly RequestDelegate _next;
    private readonly EnvSecretOptions _opts;
    private readonly ILogger<EnvSecretMiddleware> _log;

    public EnvSecretMiddleware(
        RequestDelegate next,
        EnvSecretOptions opts,
        ILogger<EnvSecretMiddleware> log)
    {
        _next = next;
        _opts = opts;
        _log  = log;
    }

    public async Task Invoke(HttpContext ctx)
    {
        var path = ctx.Request.Path.Value ?? "";

        // /health (and anything outside /api/*) stays open for probes.
        if (!path.StartsWith("/api/", StringComparison.OrdinalIgnoreCase))
        {
            await _next(ctx);
            return;
        }

        var auth = ctx.Request.Headers.Authorization.ToString();
        if (string.IsNullOrWhiteSpace(auth))
        {
            await RejectAsync(ctx, "Authorization header is required");
            return;
        }

        // Legacy fallback: no signing key configured → trust the header as
        // plaintext envId (old behavior). Logged once at startup.
        if (_opts.SigningKey is null)
        {
            ctx.Items[EnvSecretOptions.ContextItemKey] = auth;
            await _next(ctx);
            return;
        }

        if (!TryResolveEnvId(auth, _opts.SigningKey, out var envId, out var reason))
        {
            await RejectAsync(ctx, reason);
            return;
        }

        ctx.Items[EnvSecretOptions.ContextItemKey] = envId;
        await _next(ctx);
    }

    private async Task RejectAsync(HttpContext ctx, string reason)
    {
        _log.LogWarning("Rejected {Path}: {Reason}", ctx.Request.Path, reason);
        ctx.Response.StatusCode = StatusCodes.Status401Unauthorized;
        await ctx.Response.WriteAsync(reason);
    }

    /// <summary>
    /// Parse <c>fbes.&lt;b64url(envId)&gt;.&lt;b64url(sig)&gt;</c>, verify the
    /// HMAC, and return the decoded envId. Pure, allocation-light, testable.
    /// </summary>
    public static bool TryResolveEnvId(
        string authHeader,
        byte[] signingKey,
        out string envId,
        out string reason)
    {
        envId = "";

        if (!authHeader.StartsWith(EnvSecretOptions.TokenPrefix, StringComparison.Ordinal))
        {
            reason = "Invalid env secret: bad prefix";
            return false;
        }

        var body = authHeader.AsSpan(EnvSecretOptions.TokenPrefix.Length);
        var dot = body.IndexOf('.');
        if (dot <= 0 || dot >= body.Length - 1)
        {
            reason = "Invalid env secret: malformed";
            return false;
        }

        var envIdB64 = body[..dot];
        var sigB64   = body[(dot + 1)..];

        if (!TryBase64UrlDecode(envIdB64, out var envIdBytes))
        {
            reason = "Invalid env secret: bad envId encoding";
            return false;
        }
        if (!TryBase64UrlDecode(sigB64, out var sigBytes))
        {
            reason = "Invalid env secret: bad signature encoding";
            return false;
        }
        if (sigBytes.Length != EnvSecretOptions.SignatureBytes)
        {
            reason = "Invalid env secret: wrong signature length";
            return false;
        }

        // HMAC-SHA256 always emits 32 bytes; compare the truncated prefix.
        Span<byte> expected = stackalloc byte[32];
        var written = HMACSHA256.HashData(signingKey, envIdBytes, expected);
        if (written != 32)
        {
            reason = "Invalid env secret: HMAC failure";
            return false;
        }

        if (!CryptographicOperations.FixedTimeEquals(
                expected[..EnvSecretOptions.SignatureBytes],
                sigBytes))
        {
            reason = "Invalid env secret: signature mismatch";
            return false;
        }

        var decoded = Encoding.UTF8.GetString(envIdBytes);
        if (string.IsNullOrWhiteSpace(decoded))
        {
            reason = "Invalid env secret: empty envId";
            return false;
        }

        envId  = decoded;
        reason = "";
        return true;
    }

    private static bool TryBase64UrlDecode(ReadOnlySpan<char> input, out byte[] output)
    {
        // Upper-bound the decoded size; Base64Url writes the actual length.
        var buffer = new byte[Base64Url.GetMaxDecodedLength(input.Length)];
        var status = Base64Url.DecodeFromChars(input, buffer, out _, out var bytesWritten);
        if (status != OperationStatus.Done)
        {
            output = Array.Empty<byte>();
            return false;
        }
        if (bytesWritten == buffer.Length)
        {
            output = buffer;
        }
        else
        {
            output = new byte[bytesWritten];
            Buffer.BlockCopy(buffer, 0, output, 0, bytesWritten);
        }
        return true;
    }
}

/// <summary>
/// Extension that pulls the validated envId out of <see cref="HttpContext"/>.
/// Handlers MUST use this instead of reading the Authorization header directly.
/// </summary>
public static class EnvSecretContext
{
    public static string GetEnvId(this HttpContext ctx) =>
        ctx.Items[EnvSecretOptions.ContextItemKey] as string
        ?? throw new InvalidOperationException(
            "envId missing from HttpContext — EnvSecretMiddleware must run before the endpoint");
}
