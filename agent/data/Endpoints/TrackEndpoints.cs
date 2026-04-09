using System.Text.Json;
using FRD.DataServer.Models;
using FRD.DataServer.Services;

namespace FRD.DataServer.Endpoints;

public static class TrackEndpoints
{
    public static void MapTrackEndpoints(this WebApplication app)
    {
        app.MapPost("/api/track", HandleTrackAsync);
        app.MapGet("/health", () => Results.Ok(new { status = "healthy" }));
    }

    private static async Task<IResult> HandleTrackAsync(
        HttpContext ctx,
        EventChannel channel,
        ILogger<EventChannel> logger)
    {
        // 1. Auth — extract envId from Authorization header
        if (!EnvAuth.TryGetEnvId(ctx.Request.Headers.Authorization, out var envId))
        {
            return Results.Unauthorized();
        }

        // 2. Parse body
        TrackPayload[]? payloads;
        try
        {
            payloads = await ctx.Request.ReadFromJsonAsync<TrackPayload[]>();
        }
        catch (JsonException)
        {
            return Results.BadRequest(new { error = "Invalid JSON" });
        }

        if (payloads is null || payloads.Length == 0)
        {
            return Results.Ok();
        }

        // 3. Process each payload
        var flagCount = 0;
        var metricCount = 0;

        foreach (var payload in payloads)
        {
            if (!payload.IsValid())
                continue;

            var userKey = payload.User.KeyId;

            // 3a. Flag evaluations → channel
            foreach (var v in payload.Variations)
            {
                var msg = new FlagEvalMessage
                {
                    EnvId = envId,
                    FlagKey = v.FlagKey,
                    UserKey = userKey,
                    Variant = v.Variant,
                    ExperimentId = v.ExperimentId,
                    LayerId = v.LayerId,
                    EvaluatedAt = DateTimeOffset.FromUnixTimeSeconds(v.Timestamp),
                    UserProps = payload.User.Properties,
                };

                await channel.FlagEvalWriter.WriteAsync(msg);
                flagCount++;
            }

            // 3b. Metric events → channel
            foreach (var m in payload.Metrics)
            {
                var msg = new MetricEventMessage
                {
                    EnvId = envId,
                    EventName = m.EventName,
                    UserKey = userKey,
                    NumericValue = m.NumericValue,
                    OccurredAt = DateTimeOffset.FromUnixTimeSeconds(m.Timestamp),
                    Source = m.AppType,
                    Route = m.Route,
                    AppType = m.AppType,
                    Props = m.Props is { Count: > 0 }
                        ? JsonSerializer.Serialize(m.Props)
                        : null
                };

                await channel.MetricEventWriter.WriteAsync(msg);
                metricCount++;
            }
        }

        logger.LogDebug("Enqueued {FlagCount} flag evals, {MetricCount} metric events for env {EnvId}",
            flagCount, metricCount, envId);

        return Results.Ok();
    }
}
