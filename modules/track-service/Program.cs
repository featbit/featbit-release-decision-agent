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

// ── Services ──────────────────────────────────────────────────────────────────

builder.Services.AddSingleton<EventQueue>();
builder.Services.AddSingleton<ClickHouseIngestClient>();
builder.Services.AddSingleton<ClickHouseQueryClient>();
builder.Services.AddHostedService<BatchIngestWorker>();

// ── Build ─────────────────────────────────────────────────────────────────────

var app = builder.Build();

// ── Endpoints ─────────────────────────────────────────────────────────────────

app.MapGet("/health", () => Results.Ok(new { status = "healthy" }));
app.MapTrack();
app.MapQuery();

await app.RunAsync();
