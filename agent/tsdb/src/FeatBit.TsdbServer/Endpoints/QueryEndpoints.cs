using System.Text.Json;
using FeatBit.DataWarehouse.Query;
using FeatBit.TsdbServer.Models;
using FeatBit.TsdbServer.Services;

namespace FeatBit.TsdbServer.Endpoints;

public static class QueryEndpoints
{
    private static readonly JsonSerializerOptions FilterJsonOpts = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
    };

    public static void MapQueryEndpoints(this WebApplication app)
    {
        app.MapPost("/api/query/experiment", HandleQueryAsync);
    }

    private static async Task<IResult> HandleQueryAsync(
        HttpContext ctx,
        ExperimentQueryEngine queryEngine,
        ILogger<ExperimentQueryEngine> logger)
    {
        if (!EnvAuth.TryGetEnvId(ctx.Request.Headers.Authorization, out _))
            return Results.Unauthorized();

        ExperimentQueryRequest? req;
        try
        {
            req = await ctx.Request.ReadFromJsonAsync<ExperimentQueryRequest>(FilterJsonOpts);
        }
        catch (JsonException)
        {
            return Results.BadRequest(new { error = "Invalid JSON" });
        }

        if (req is null)
            return Results.BadRequest(new { error = "Empty request body" });

        var query = new ExperimentQuery
        {
            EnvId            = req.EnvId,
            FlagKey          = req.FlagKey,
            MetricEvent      = req.MetricEvent,
            MetricType       = req.MetricType,
            MetricAgg        = req.MetricAgg,
            ControlVariant   = req.ControlVariant,
            TreatmentVariants = [req.TreatmentVariant],
            Start            = req.Start,
            End              = req.End,
            ExperimentId     = req.ExperimentId,
            LayerId          = req.LayerId,
            TrafficPercent   = req.TrafficPercent,
            TrafficOffset    = req.TrafficOffset,
            AudienceFilters  = ParseAudienceFilters(req.AudienceFilters),
            Method           = req.Method,
        };

        try
        {
            var result = await queryEngine.QueryAsync(query, ctx.RequestAborted);
            var response = MapToResponse(result);
            return Results.Ok(response);
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "Query failed for env={EnvId} flag={FlagKey} metric={MetricEvent}",
                req.EnvId, req.FlagKey, req.MetricEvent);
            return Results.Problem("Query failed", statusCode: 500);
        }
    }

    private static ExperimentQueryResponse MapToResponse(ExperimentResult result)
    {
        var variants = new Dictionary<string, VariantStatsDto>(result.Variants.Count);

        foreach (var (variantKey, stats) in result.Variants)
        {
            variants[variantKey] = stats switch
            {
                BinaryVariantStats b => new VariantStatsDto { N = b.N, K = b.K },
                ContinuousVariantStats c => new VariantStatsDto
                {
                    N = c.N,
                    Mean = c.Mean,
                    Variance = c.Variance,
                    Total = c.Total,
                },
                _ => new VariantStatsDto { N = 0 },
            };
        }

        return new ExperimentQueryResponse
        {
            MetricType = result.MetricType,
            Variants   = variants,
        };
    }

    private static IReadOnlyList<AudienceFilter>? ParseAudienceFilters(string? json)
    {
        if (string.IsNullOrWhiteSpace(json)) return null;
        try
        {
            return JsonSerializer.Deserialize<List<AudienceFilter>>(json, FilterJsonOpts);
        }
        catch
        {
            return null;
        }
    }
}
