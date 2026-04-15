using System.Globalization;
using ClickHouse.Client.ADO;
using FeatBit.TrackService.Models;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;

namespace FeatBit.TrackService.Services;

/// <summary>
/// Reads per-variant aggregates needed for Bayesian / Bandit analysis.
///
/// One ClickHouse query, executed at request time, joins flag_evaluations to
/// metric_events on user_key. For each user we lock in the variant they saw
/// FIRST (argMin on timestamp) and count whether they fired the metric event
/// at least once during the window.
/// </summary>
public sealed class ClickHouseQueryClient(
    IOptions<ClickHouseOptions> opts,
    ILogger<ClickHouseQueryClient> log)
{
    private readonly ClickHouseOptions _cfg = opts.Value;

    public async Task<List<VariantStats>> GetVariantStatsAsync(
        string envId,
        string flagKey,
        string metricEvent,
        DateOnly start,
        DateOnly end,
        CancellationToken ct)
    {
        var sql = $@"
WITH first_eval AS
(
    SELECT
        user_key,
        argMin(variant, timestamp) AS variant
    FROM {_cfg.Database}.{_cfg.FlagEvaluationsTable}
    WHERE env_id   = {{envId:String}}
      AND flag_key = {{flagKey:String}}
      AND toDate(timestamp) BETWEEN {{start:Date}} AND {{end:Date}}
    GROUP BY user_key
),
conversions AS
(
    SELECT
        user_key,
        count() AS conv_count,
        sum(ifNull(numeric_value, 0))                              AS sum_val,
        sum(ifNull(numeric_value, 0) * ifNull(numeric_value, 0))   AS sum_sq
    FROM {_cfg.Database}.{_cfg.MetricEventsTable}
    WHERE env_id     = {{envId:String}}
      AND event_name = {{metric:String}}
      AND toDate(timestamp) BETWEEN {{start:Date}} AND {{end:Date}}
    GROUP BY user_key
)
SELECT
    fe.variant                AS variant,
    count()                   AS users,
    countIf(c.conv_count > 0) AS conversions,
    sum(c.sum_val)            AS sum_val,
    sum(c.sum_sq)             AS sum_sq
FROM first_eval AS fe
LEFT JOIN conversions AS c ON c.user_key = fe.user_key
GROUP BY variant
ORDER BY variant;
";

        await using var conn = new ClickHouseConnection(_cfg.ConnectionString);
        await conn.OpenAsync(ct);

        await using var cmd = conn.CreateCommand();
        cmd.CommandText = sql;
        AddParam(cmd, "envId",   envId);
        AddParam(cmd, "flagKey", flagKey);
        AddParam(cmd, "metric",  metricEvent);
        AddParam(cmd, "start",   start.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture));
        AddParam(cmd, "end",     end.ToString("yyyy-MM-dd",   CultureInfo.InvariantCulture));

        var results = new List<VariantStats>();
        await using var reader = await cmd.ExecuteReaderAsync(ct);
        while (await reader.ReadAsync(ct))
        {
            results.Add(new VariantStats
            {
                Variant     = reader.GetString(0),
                Users       = Convert.ToInt64(reader.GetValue(1)),
                Conversions = Convert.ToInt64(reader.GetValue(2)),
                SumValue    = Convert.ToDouble(reader.GetValue(3)),
                SumSquares  = Convert.ToDouble(reader.GetValue(4)),
            });
        }

        log.LogInformation(
            "Query env={Env} flag={Flag} metric={Metric} range={Start}..{End} → {N} variant(s)",
            envId, flagKey, metricEvent, start, end, results.Count);

        return results;
    }

    /// <summary>Standard ADO.NET parameter add — ClickHouse.Client maps these
    /// to {name:Type} placeholders inferred from the .NET runtime type.</summary>
    private static void AddParam(System.Data.Common.DbCommand cmd, string name, object value)
    {
        var p = cmd.CreateParameter();
        p.ParameterName = name;
        p.Value         = value;
        cmd.Parameters.Add(p);
    }
}
