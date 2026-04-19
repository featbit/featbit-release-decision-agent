using System.Text.Json;
using FeatBit.TrackService.Models;
using FeatBit.TrackService.Services;

namespace FeatBit.TrackService.Endpoints;

public static class TrackEndpoint
{
    public static IEndpointRouteBuilder MapTrack(this IEndpointRouteBuilder app)
    {
        // Single event: POST /api/track/event
        app.MapPost("/api/track/event", (
            HttpContext ctx,
            TrackPayload payload,
            EventQueue queue,
            ILogger<EventQueue> log) =>
        {
            var envId = ctx.Request.Headers.Authorization.ToString();
            if (string.IsNullOrWhiteSpace(envId))
                return Results.BadRequest("Authorization header (envId) is required");

            var enq = EnqueuePayload(payload, envId, queue);
            if (enq.dropped > 0)
                log.LogWarning("Dropped {Dropped}/{Total} events (queue full)", enq.dropped, enq.total);

            return Results.Accepted(value: new { accepted = enq.total - enq.dropped, dropped = enq.dropped });
        });

        // Batch: POST /api/track  — same wire format as the old cf-worker
        app.MapPost("/api/track", async (
            HttpContext ctx,
            EventQueue queue,
            ILogger<EventQueue> log) =>
        {
            var envId = ctx.Request.Headers.Authorization.ToString();
            if (string.IsNullOrWhiteSpace(envId))
                return Results.BadRequest("Authorization header (envId) is required");

            List<TrackPayload>? payloads;
            try
            {
                payloads = await JsonSerializer.DeserializeAsync<List<TrackPayload>>(
                    ctx.Request.Body, cancellationToken: ctx.RequestAborted);
            }
            catch (JsonException)
            {
                return Results.BadRequest("Invalid JSON body");
            }
            if (payloads is null || payloads.Count == 0)
                return Results.BadRequest("Empty payload");

            int total = 0, dropped = 0;
            foreach (var p in payloads)
            {
                var r = EnqueuePayload(p, envId, queue);
                total   += r.total;
                dropped += r.dropped;
            }

            if (dropped > 0)
                log.LogWarning("Dropped {Dropped}/{Total} events (queue full)", dropped, total);

            return Results.Accepted(value: new { accepted = total - dropped, dropped });
        });

        return app;
    }

    private static (int total, int dropped) EnqueuePayload(TrackPayload p, string envId, EventQueue queue)
    {
        int total = 0, dropped = 0;
        var props = p.User.Properties is { Count: > 0 }
            ? JsonSerializer.Serialize(p.User.Properties)
            : "{}";

        foreach (var v in p.Variations ?? new())
        {
            var rec = new EventRecord
            {
                Table         = TableKind.FlagEvaluation,
                EnvId         = envId,
                UserKey       = p.User.KeyId,
                Timestamp     = DateTimeOffset.FromUnixTimeMilliseconds(v.Timestamp).UtcDateTime,
                FlagKey       = v.FlagKey,
                Variant       = v.Variant,
                ExperimentId  = v.ExperimentId,
                LayerId       = v.LayerId,
                HashBucket    = HashBucket.Compute(p.User.KeyId, v.FlagKey),
                UserPropsJson = props,
            };
            total++;
            if (!queue.TryWrite(rec)) dropped++;
        }

        foreach (var m in p.Metrics ?? new())
        {
            var rec = new EventRecord
            {
                Table         = TableKind.MetricEvent,
                EnvId         = envId,
                UserKey       = p.User.KeyId,
                Timestamp     = DateTimeOffset.FromUnixTimeMilliseconds(m.Timestamp).UtcDateTime,
                EventName     = m.EventName,
                NumericValue  = m.NumericValue,
                UserPropsJson = props,
            };
            total++;
            if (!queue.TryWrite(rec)) dropped++;
        }

        return (total, dropped);
    }
}
