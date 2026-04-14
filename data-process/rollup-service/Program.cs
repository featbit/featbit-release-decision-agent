using FeatBit.RollupService.Models;
using FeatBit.RollupService.Services;

var runOnce = args.Contains("--run-once");

var builder = Host.CreateDefaultBuilder(args)
    .ConfigureServices((ctx, services) =>
    {
        var cfg = ctx.Configuration;

        // R2 credentials — read from env vars or appsettings
        services.Configure<R2Options>(o =>
        {
            o.AccountId   = cfg["R2:AccountId"]   ?? Environment.GetEnvironmentVariable("R2_ACCOUNT_ID")        ?? "";
            o.AccessKeyId = cfg["R2:AccessKeyId"] ?? Environment.GetEnvironmentVariable("R2_ACCESS_KEY_ID")     ?? "";
            o.SecretKey   = cfg["R2:SecretKey"]   ?? Environment.GetEnvironmentVariable("R2_SECRET_ACCESS_KEY") ?? "";
            o.BucketName  = cfg["R2:BucketName"]  ?? "featbit-tsdb";
        });

        services.Configure<WorkerOptions>(o =>
        {
            o.IntervalSeconds = int.TryParse(cfg["Worker:IntervalSeconds"], out var s) ? s : 600;
            o.MaxConcurrency  = int.TryParse(cfg["Worker:MaxConcurrency"],  out var c) ? c : 4;
        });

        services.AddSingleton<R2Client>();
        services.AddSingleton<DeltaProcessor>();

        if (!runOnce)
            services.AddHostedService<RollupWorker>();
    })
    .ConfigureLogging(l => l.AddConsole())
    .Build();

if (runOnce)
{
    // Process all pending deltas once and exit
    var worker = new RollupWorker(
        builder.Services.GetRequiredService<R2Client>(),
        builder.Services.GetRequiredService<DeltaProcessor>(),
        builder.Services.GetRequiredService<Microsoft.Extensions.Options.IOptions<WorkerOptions>>(),
        builder.Services.GetRequiredService<Microsoft.Extensions.Logging.ILogger<RollupWorker>>());

    await worker.RunCycleAsync(CancellationToken.None);
}
else
{
    await builder.RunAsync();
}
