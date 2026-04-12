namespace FeatBit.TsdbServer.Endpoints;

public static class StatsEndpoints
{
    public static void MapStatsEndpoints(this WebApplication app)
    {
        app.MapGet("/api/stats", HandleStatsAsync);
    }

    private static Task<IResult> HandleStatsAsync(IConfiguration config)
    {
        var dataRoot = config["DataRoot"] ?? "/data/tsdb";

        var flagEvalsDir   = Path.Combine(dataRoot, "flag-evals");
        var metricEventsDir = Path.Combine(dataRoot, "metric-events");

        var flagEvals   = ScanDir(flagEvalsDir);
        var metricEvents = ScanDir(metricEventsDir);

        var result = new
        {
            dataRoot,
            total = new
            {
                files     = flagEvals.Files + metricEvents.Files,
                sizeBytes = flagEvals.Bytes + metricEvents.Bytes,
                sizeHuman = FormatBytes(flagEvals.Bytes + metricEvents.Bytes),
            },
            flagEvals = new
            {
                files     = flagEvals.Files,
                sizeBytes = flagEvals.Bytes,
                sizeHuman = FormatBytes(flagEvals.Bytes),
            },
            metricEvents = new
            {
                files     = metricEvents.Files,
                sizeBytes = metricEvents.Bytes,
                sizeHuman = FormatBytes(metricEvents.Bytes),
            },
        };

        return Task.FromResult(Results.Ok(result));
    }

    private static (long Files, long Bytes) ScanDir(string dir)
    {
        if (!Directory.Exists(dir))
            return (0, 0);

        long files = 0;
        long bytes = 0;

        foreach (var file in Directory.EnumerateFiles(dir, "*.fbs", SearchOption.AllDirectories))
        {
            files++;
            bytes += new FileInfo(file).Length;
        }

        return (files, bytes);
    }

    private static string FormatBytes(long bytes) => bytes switch
    {
        < 1024              => $"{bytes} B",
        < 1024 * 1024       => $"{bytes / 1024.0:F1} KB",
        < 1024 * 1024 * 1024 => $"{bytes / (1024.0 * 1024):F1} MB",
        _                   => $"{bytes / (1024.0 * 1024 * 1024):F2} GB",
    };
}
