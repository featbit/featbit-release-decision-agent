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
/// FIRST (argMin on timestamp) and capture that exposure timestamp, then only
/// count metric events that fire AT OR AFTER the user's first exposure — so
/// pre-exposure behaviour can never be mis-attributed to a variant.
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
        // Unit of analysis is the user: n = users, x_i = that user's total
        // numeric_value across all qualifying metric events. The stats client
        // (modules/web/src/lib/stats/bayesian.ts) computes
        //   variance = (sum_sq - sum_val² / users) / (users - 1)
        // which only makes sense if sum_sq = Σ(per-user total)², not
        // Σ(per-event value²). That's why we aggregate per-user in user_totals
        // FIRST and only square at the outer layer.
        var sql = $@"
WITH first_eval AS
(
    SELECT
        user_key,
        argMin(variant, timestamp) AS variant,
        min(timestamp)             AS exposure_ts
    FROM {_cfg.Database}.{_cfg.FlagEvaluationsTable}
    WHERE env_id   = {{envId:String}}
      AND flag_key = {{flagKey:String}}
      AND toDate(timestamp) BETWEEN {{start:Date}} AND {{end:Date}}
    GROUP BY user_key
),
user_totals AS
(
    SELECT
        m.user_key                       AS user_key,
        count()                          AS conv_count,
        sum(ifNull(m.numeric_value, 0))  AS sum_val_user
    FROM {_cfg.Database}.{_cfg.MetricEventsTable} AS m
    INNER JOIN first_eval AS fe ON fe.user_key = m.user_key
    WHERE m.env_id     = {{envId:String}}
      AND m.event_name = {{metric:String}}
      AND toDate(m.timestamp) BETWEEN {{start:Date}} AND {{end:Date}}
      AND m.timestamp >= fe.exposure_ts
    GROUP BY m.user_key
)
SELECT
    fe.variant                                                          AS variant,
    count()                                                             AS users,
    countIf(ut.conv_count > 0)                                          AS conversions,
    sum(ifNull(ut.sum_val_user, 0))                                     AS sum_val,
    sum(ifNull(ut.sum_val_user, 0) * ifNull(ut.sum_val_user, 0))        AS sum_sq
FROM first_eval AS fe
LEFT JOIN user_totals AS ut ON ut.user_key = fe.user_key
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
