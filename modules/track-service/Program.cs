using System.Text;
using FeatBit.TrackService.Endpoints;
using FeatBit.TrackService.Services;

var builder = WebApplication.CreateBuilder(args);
var cfg     = builder.Configuration;

// ── Options ───────────────────────────────────────────────────────────────────

builder.Services.Configure<ClickHouseOptions>(o =>
{
    // Prefer env var → fall back to appsettings. Use NullIfEmpty since
    // appsettings.json ships with an empty placeholder that should not win.
    o.ConnectionString =
        NullIfEmpty(Environment.GetEnvironmentVariable("CLICKHOUSE_CONNECTION_STRING"))
        ?? NullIfEmpty(cfg["ClickHouse:ConnectionString"])
        ?? "";

    o.Database             = NullIfEmpty(cfg["ClickHouse:Database"])             ?? "featbit";
    o.FlagEvaluationsTable = NullIfEmpty(cfg["ClickHouse:FlagEvaluationsTable"]) ?? "flag_evaluations";
    o.MetricEventsTable    = NullIfEmpty(cfg["ClickHouse:MetricEventsTable"])    ?? "metric_events";

    if (string.IsNullOrWhiteSpace(o.ConnectionString))
        throw new InvalidOperationException(
            "ClickHouse connection string not configured. Set CLICKHOUSE_CONNECTION_STRING " +
            "env var or ClickHouse:ConnectionString in appsettings.");

    static string? NullIfEmpty(string? s) => string.IsNullOrWhiteSpace(s) ? null : s;
});

builder.Services.Configure<IngestOptions>(o =>
{
    o.ChannelCapacity = int.TryParse(cfg["Ingest:ChannelCapacity"], out var c) ? c : 100_000;
    o.BatchSize       = int.TryParse(cfg["Ingest:BatchSize"],       out var b) ? b : 1_000;
    o.FlushIntervalMs = int.TryParse(cfg["Ingest:FlushIntervalMs"], out var f) ? f : 5_000;
});

// Env secret signing key (HMAC-SHA256). Shared with the web service that mints
// tokens. Env var wins over appsettings so k8s Secrets / docker-compose env
// override the image default without a rebuild.
var envSecretOpts = new EnvSecretOptions();
var rawSigningKey =
    Environment.GetEnvironmentVariable("TRACK_SERVICE_SIGNING_KEY")
    ?? cfg["Auth:SigningKey"];
if (!string.IsNullOrWhiteSpace(rawSigningKey))
{
    envSecretOpts.SigningKey = Encoding.UTF8.GetBytes(rawSigningKey);
}
builder.Services.AddSingleton(envSecretOpts);

// ── Services ──────────────────────────────────────────────────────────────────

builder.Services.AddSingleton<EventQueue>();
builder.Services.AddSingleton<ClickHouseIngestClient>();
builder.Services.AddSingleton<ClickHouseQueryClient>();
builder.Services.AddHostedService<BatchIngestWorker>();

// ── Build ─────────────────────────────────────────────────────────────────────

var app = builder.Build();

if (envSecretOpts.SigningKey is null)
{
    app.Logger.LogWarning(
        "TRACK_SERVICE_SIGNING_KEY not set — /api/* trusts the Authorization " +
        "header as a plaintext envId (legacy mode). Only safe for local dev.");
}
else
{
    app.Logger.LogInformation(
        "Env secret validation enabled: fbes.<b64url(envId)>.<b64url(hmac)>");
}

app.UseMiddleware<EnvSecretMiddleware>();

// ── Endpoints ─────────────────────────────────────────────────────────────────

app.MapGet("/health", () => Results.Ok(new { status = "healthy" }));
app.MapTrack();
app.MapQuery();

await app.RunAsync();
