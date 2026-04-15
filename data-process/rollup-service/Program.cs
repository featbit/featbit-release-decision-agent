using FeatBit.RollupService.Models;
using FeatBit.RollupService.Services;

var runOnce = args.Contains("--run-once");

var builder = WebApplication.CreateBuilder(args);
var cfg     = builder.Configuration;

// ── Services ──────────────────────────────────────────────────────────────────

builder.Services.Configure<R2Options>(o =>
{
    o.AccountId   = cfg["R2:AccountId"]   ?? Environment.GetEnvironmentVariable("R2_ACCOUNT_ID")        ?? "";
    o.AccessKeyId = cfg["R2:AccessKeyId"] ?? Environment.GetEnvironmentVariable("R2_ACCESS_KEY_ID")     ?? "";
    o.SecretKey   = cfg["R2:SecretKey"]   ?? Environment.GetEnvironmentVariable("R2_SECRET_ACCESS_KEY") ?? "";
    o.BucketName  = cfg["R2:BucketName"]  ?? "featbit-tsdb";
});

builder.Services.Configure<WorkerOptions>(o =>
{
    o.IntervalSeconds = int.TryParse(cfg["Worker:IntervalSeconds"], out var s) ? s : 600;
    o.MaxConcurrency  = int.TryParse(cfg["Worker:MaxConcurrency"],  out var c) ? c : 4;
});

builder.Services.Configure<DatabaseOptions>(o =>
{
    o.Url = cfg["Database:Url"]
        ?? Environment.GetEnvironmentVariable("DATABASE_URL")
        ?? "";
});

builder.Services.AddSingleton<R2Client>();
builder.Services.AddSingleton<DeltaProcessor>();
builder.Services.AddSingleton<DbClient>();

if (!runOnce)
    builder.Services.AddHostedService<RollupWorker>();

// ── Build ─────────────────────────────────────────────────────────────────────

var app = builder.Build();

// ── Health endpoint ───────────────────────────────────────────────────────────

app.MapGet("/health", () => Results.Ok(new { status = "healthy" }));

// ── Run ───────────────────────────────────────────────────────────────────────

if (runOnce)
{
    // Process all pending deltas once and exit (no HTTP server needed)
    var worker = new RollupWorker(
        app.Services.GetRequiredService<R2Client>(),
        app.Services.GetRequiredService<DeltaProcessor>(),
        app.Services.GetRequiredService<DbClient>(),
        app.Services.GetRequiredService<Microsoft.Extensions.Options.IOptions<WorkerOptions>>(),
        app.Services.GetRequiredService<Microsoft.Extensions.Logging.ILogger<RollupWorker>>());

    await worker.RunCycleAsync(CancellationToken.None);
}
else
{
    await app.RunAsync();
}
