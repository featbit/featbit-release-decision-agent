using FeatBit.DataWarehouse;
using FeatBit.DataWarehouse.Models;
using FeatBit.TsdbServer.Models;
using FeatBit.TsdbServer.Services;

namespace FeatBit.TsdbServer.Endpoints;

public static class TrackEndpoints
{
    public static void MapTrackEndpoints(this WebApplication app)
    {
        app.MapPost("/api/track", HandleTrackAsync);
        app.MapGet("/health", () => Results.Ok(new { status = "healthy" }));
    }

    private static async Task<IResult> HandleTrackAsync(
        HttpContext ctx,
        StorageEngine storage,
        ILogger<StorageEngine> logger)
    {
        if (!EnvAuth.TryGetEnvId(ctx.Request.Headers.Authorization, out var envId))
            return Results.Unauthorized();

        TrackPayload[]? payloads;
        try
        {
            payloads = await ctx.Request.ReadFromJsonAsync<TrackPayload[]>();
        }
        catch (System.Text.Json.JsonException)
        {
            return Results.BadRequest(new { error = "Invalid JSON" });
        }

        if (payloads is null || payloads.Length == 0)
            return Results.Ok();

        var flagCount = 0;
        var metricCount = 0;

        foreach (var payload in payloads)
        {
            if (!payload.IsValid()) continue;

            var userKey = payload.User.KeyId;

            foreach (var v in payload.Variations)
            {
                var record = FlagEvalRecord.Create(
                    envId: envId,
                    flagKey: v.FlagKey,
                    userKey: userKey,
                    variant: v.Variant,
                    timestampMs: v.Timestamp * 1000L,
                    experimentId: v.ExperimentId,
                    layerId: v.LayerId,
                    userProps: payload.User.Properties);

                await storage.WriteFlagEvalAsync(record);
                flagCount++;
            }

            foreach (var m in payload.Metrics)
            {
                var record = MetricEventRecord.Create(
                    envId: envId,
                    eventName: m.EventName,
                    userKey: userKey,
                    timestampMs: m.Timestamp * 1000L,
                    numericValue: m.NumericValue,
                    source: m.AppType);

                await storage.WriteMetricEventAsync(record);
                metricCount++;
            }
        }

        logger.LogDebug("Stored {FlagCount} flag evals, {MetricCount} metric events for env {EnvId}",
            flagCount, metricCount, envId);

        return Results.Ok();
    }
}
