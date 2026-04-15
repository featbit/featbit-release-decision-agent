using System.Globalization;
using FeatBit.TrackService.Models;
using FeatBit.TrackService.Services;

namespace FeatBit.TrackService.Endpoints;

public static class QueryEndpoint
{
    public static IEndpointRouteBuilder MapQuery(this IEndpointRouteBuilder app)
    {
        // POST /api/query/experiment
        // Body: { envId, flagKey, metricEvent, startDate, endDate }
        // Returns per-variant aggregates ready for Bayesian / Bandit analysis.
        app.MapPost("/api/query/experiment", async (
            ExperimentQueryRequest req,
            ClickHouseQueryClient ch,
            CancellationToken ct) =>
        {
            if (string.IsNullOrWhiteSpace(req.EnvId) ||
                string.IsNullOrWhiteSpace(req.FlagKey) ||
                string.IsNullOrWhiteSpace(req.MetricEvent) ||
                string.IsNullOrWhiteSpace(req.StartDate) ||
                string.IsNullOrWhiteSpace(req.EndDate))
            {
                return Results.BadRequest("envId, flagKey, metricEvent, startDate, endDate are all required");
            }

            if (!DateOnly.TryParseExact(req.StartDate, "yyyy-MM-dd", CultureInfo.InvariantCulture, DateTimeStyles.None, out var start) ||
                !DateOnly.TryParseExact(req.EndDate,   "yyyy-MM-dd", CultureInfo.InvariantCulture, DateTimeStyles.None, out var end))
            {
                return Results.BadRequest("startDate and endDate must be YYYY-MM-DD");
            }
            if (end < start) return Results.BadRequest("endDate must be >= startDate");

            var variants = await ch.GetVariantStatsAsync(
                req.EnvId, req.FlagKey, req.MetricEvent, start, end, ct);

            return Results.Ok(new ExperimentQueryResponse
            {
                EnvId       = req.EnvId,
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
