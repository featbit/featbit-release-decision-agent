using System.Globalization;
using FeatBit.TrackService.Models;
using FeatBit.TrackService.Services;

namespace FeatBit.TrackService.Endpoints;

public static class QueryEndpoint
{
    public static IEndpointRouteBuilder MapQuery(this IEndpointRouteBuilder app)
    {
        // POST /api/query/experiment
        // Body: { flagKey, metricEvent, startDate, endDate } — envId is taken
        // from the validated Authorization token (not the body), so a caller
        // signed for envA cannot query envB's data.
        app.MapPost("/api/query/experiment", async (
            HttpContext ctx,
            ExperimentQueryRequest req,
            ClickHouseQueryClient ch,
            CancellationToken ct) =>
        {
            var envId = ctx.GetEnvId();

            if (string.IsNullOrWhiteSpace(req.FlagKey) ||
                string.IsNullOrWhiteSpace(req.MetricEvent) ||
                string.IsNullOrWhiteSpace(req.StartDate) ||
                string.IsNullOrWhiteSpace(req.EndDate) ||
                string.IsNullOrWhiteSpace(req.MetricType) ||
                string.IsNullOrWhiteSpace(req.MetricAgg))
            {
                return Results.BadRequest(
                    "flagKey, metricEvent, startDate, endDate, metricType, metricAgg are all required");
            }
            if (req.MetricType is not ("binary" or "continuous"))
                return Results.BadRequest("metricType must be 'binary' or 'continuous'");
            if (req.MetricAgg is not ("once" or "count" or "sum" or "average"))
                return Results.BadRequest("metricAgg must be 'once' | 'count' | 'sum' | 'average'");

            // Back-compat: if the body also carries envId, require it to match
            // the token's envId. Catches stale callers pointing at the wrong env.
            if (!string.IsNullOrWhiteSpace(req.EnvId) &&
                !string.Equals(req.EnvId, envId, StringComparison.Ordinal))
            {
                return Results.BadRequest("body envId does not match the authenticated envId");
            }

            if (!DateOnly.TryParseExact(req.StartDate, "yyyy-MM-dd", CultureInfo.InvariantCulture, DateTimeStyles.None, out var start) ||
                !DateOnly.TryParseExact(req.EndDate,   "yyyy-MM-dd", CultureInfo.InvariantCulture, DateTimeStyles.None, out var end))
            {
                return Results.BadRequest("startDate and endDate must be YYYY-MM-DD");
            }
            if (end < start) return Results.BadRequest("endDate must be >= startDate");

            var variants = await ch.GetVariantStatsAsync(
                envId, req.FlagKey, req.MetricEvent, start, end,
                req.MetricType, req.MetricAgg, ct);

            return Results.Ok(new ExperimentQueryResponse
            {
                EnvId       = envId,
                FlagKey     = req.FlagKey,
                MetricEvent = req.MetricEvent,
                Window      = new ExperimentQueryResponse.WindowInfo
                {
                    Start = req.StartDate,
                    End   = req.EndDate,
                },
                Variants = variants,
            });
        });

        return app;
    }
}
