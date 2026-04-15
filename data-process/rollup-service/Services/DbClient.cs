using System.Text.RegularExpressions;
using FeatBit.RollupService.Models;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using Npgsql;

namespace FeatBit.RollupService.Services;

/// <summary>
/// Queries PostgreSQL for currently running experiments and returns the R2 key
/// segment sets used to filter which delta files the rollup worker should process.
///
/// Fail-open: if the DB is unreachable or not configured, returns empty sets and
/// the worker falls back to processing all deltas.
/// </summary>
public sealed class DbClient(IOptions<DatabaseOptions> opts, ILogger<DbClient> log)
{
    private static readonly Regex SanitizeRx = new(@"[^\w-]", RegexOptions.Compiled);

    private static string Sanitize(string s) => SanitizeRx.Replace(s, "_");

    /// <summary>
    /// Returns two sets of allowed "{sanitizedEnvId}/{sanitizedKey}" segments:
    ///   FlagEval    — matches against parts[2]/parts[3] of deltas/flag-evals/… keys
    ///   MetricEvent — matches against parts[2]/parts[3] of deltas/metric-events/… keys
    ///
    /// Empty sets mean "DB not configured or unavailable" → caller processes all deltas.
    /// </summary>
    public async Task<(HashSet<string> FlagEval, HashSet<string> MetricEvent)>
        GetRunningKeySegmentsAsync(CancellationToken ct)
    {
        var feSet = new HashSet<string>(StringComparer.Ordinal);
        var meSet = new HashSet<string>(StringComparer.Ordinal);

        var url = opts.Value.Url;
        if (string.IsNullOrWhiteSpace(url))
        {
            log.LogDebug("Database.Url not configured; processing all deltas.");
            return (feSet, meSet);
        }

        const string Sql = """
            SELECT e.featbit_env_id, e.flag_key, er.primary_metric_event
            FROM   experiment_run er
            JOIN   experiment e ON e.id = er.experiment_id
            WHERE  er.status = 'running'
              AND  e.featbit_env_id        IS NOT NULL
              AND  e.flag_key              IS NOT NULL
              AND  er.primary_metric_event IS NOT NULL
            """;

        try
        {
            await using var conn = new NpgsqlConnection(url);
            await conn.OpenAsync(ct);
            await using var cmd    = new NpgsqlCommand(Sql, conn);
            await using var reader = await cmd.ExecuteReaderAsync(ct);

            while (await reader.ReadAsync(ct))
            {
                var envId  = Sanitize(reader.GetString(0));
                var flag   = Sanitize(reader.GetString(1));
                var metric = Sanitize(reader.GetString(2));
                feSet.Add($"{envId}/{flag}");
                meSet.Add($"{envId}/{metric}");
            }
        }
        catch (Exception ex)
        {
            log.LogWarning(ex,
                "Could not query running experiments from DB — will process all deltas (fail-open).");
            return (feSet, meSet);
        }

        log.LogInformation(
            "DB filter active: {Fe} flag-eval prefix(es), {Me} metric-event prefix(es).",
            feSet.Count, meSet.Count);

        return (feSet, meSet);
    }
}
