using Amazon.S3;
using Amazon.S3.Model;
using FeatBit.RollupService.Models;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;

namespace FeatBit.RollupService.Services;

/// <summary>
/// Thin wrapper around AmazonS3Client pointed at Cloudflare R2.
/// R2 is S3-compatible; uses path-style addressing.
/// </summary>
public sealed class R2Client : IDisposable
{
    private readonly AmazonS3Client _s3;
    private readonly string         _bucket;
    private readonly ILogger        _log;

    public R2Client(IOptions<R2Options> opts, ILogger<R2Client> log)
    {
        var o = opts.Value;
        _bucket = o.BucketName;
        _log    = log;

        var cfg = new AmazonS3Config
        {
            ServiceURL    = $"https://{o.AccountId}.r2.cloudflarestorage.com",
            ForcePathStyle = true,
        };
        _s3 = new AmazonS3Client(o.AccessKeyId, o.SecretKey, cfg);
    }

    // ── List ─────────────────────────────────────────────────────────────────

    /// <summary>Return all object keys under <paramref name="prefix"/> (auto-paginates).</summary>
    public async Task<List<string>> ListKeysAsync(string prefix, CancellationToken ct = default)
    {
        var keys = new List<string>();
        string? token = null;

        do
        {
            var req = new ListObjectsV2Request
            {
                BucketName            = _bucket,
                Prefix                = prefix,
                ContinuationToken     = token,
            };
            var resp = await _s3.ListObjectsV2Async(req, ct);
            foreach (var o in resp.S3Objects) keys.Add(o.Key);
            token = resp.IsTruncated ? resp.NextContinuationToken : null;
        }
        while (token is not null);

        return keys;
    }

    // ── Get ──────────────────────────────────────────────────────────────────

    public async Task<string?> GetStringAsync(string key, CancellationToken ct = default)
    {
        try
        {
            var resp = await _s3.GetObjectAsync(_bucket, key, ct);
            using var sr = new StreamReader(resp.ResponseStream);
            return await sr.ReadToEndAsync(ct);
        }
        catch (AmazonS3Exception ex) when (ex.StatusCode == System.Net.HttpStatusCode.NotFound)
        {
            return null;
        }
    }

    // ── Put ──────────────────────────────────────────────────────────────────

    public async Task PutStringAsync(string key, string content, CancellationToken ct = default)
    {
        var bytes = System.Text.Encoding.UTF8.GetBytes(content);
        var req = new PutObjectRequest
        {
            BucketName            = _bucket,
            Key                   = key,
            InputStream           = new MemoryStream(bytes),
            ContentType           = "application/json",
            DisablePayloadSigning = true,   // R2 does not support chunked PAYLOAD-TRAILER
            UseChunkEncoding      = false,
        };
        await _s3.PutObjectAsync(req, ct);
        _log.LogDebug("PUT {Key} ({Bytes} bytes)", key, content.Length);
    }

    // ── Delete ───────────────────────────────────────────────────────────────

    public async Task DeleteAsync(string key, CancellationToken ct = default)
    {
        await _s3.DeleteObjectAsync(_bucket, key, ct);
        _log.LogDebug("DELETE {Key}", key);
    }

    public void Dispose() => _s3.Dispose();
}
