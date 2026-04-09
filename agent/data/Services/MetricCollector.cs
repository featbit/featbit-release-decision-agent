using System.Text.Json;
using System.Text.Json.Serialization;
using Npgsql;
using NpgsqlTypes;

namespace FRD.DataServer.Services;

/// <summary>
/// Collects metric data from event tables for a single experiment,
/// returning a MetricSummary (binary or continuous) ready for analysis.
///
/// Port of agent/worker/src/adapters/featbit.ts queries.
/// </summary>
public sealed class MetricCollector
{
    private readonly NpgsqlDataSource _dataSource;
    private readonly ILogger<MetricCollector> _logger;

    public MetricCollector(NpgsqlDataSource dataSource, ILogger<MetricCollector> logger)
    {
        _dataSource = dataSource;
        _logger = logger;
    }

    public async Task<MetricSummary?> CollectAsync(ExperimentParams p, CancellationToken ct)
    {
        try
        {
            return p.MetricType == "binary"
                ? await QueryBinaryAsync(p, ct)
                : await QueryContinuousAsync(p, ct);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Failed to collect metrics for experiment {Slug}", p.Slug);
            return null;
        }
    }

    private async Task<MetricSummary> QueryBinaryAsync(ExperimentParams p, CancellationToken ct)
    {
        const string sql = """
            WITH first_exposure AS (
              SELECT DISTINCT ON (user_key)
                user_key, variant, evaluated_at AS first_exposed_at
              FROM flag_evaluations
              WHERE env_id = $1
                AND flag_key = $2
                AND experiment_id = $3
                AND evaluated_at BETWEEN $4 AND $5
              ORDER BY user_key, evaluated_at ASC
            ),
            exposed AS (
              SELECT variant, COUNT(*) AS n
              FROM first_exposure
              GROUP BY variant
            ),
            converted AS (
              SELECT fe.variant, COUNT(DISTINCT fe.user_key) AS k
              FROM first_exposure fe
              JOIN metric_events me
                ON  me.user_key      = fe.user_key
                AND me.env_id        = $1
                AND me.event_name    = $6
                AND me.occurred_at  >= fe.first_exposed_at
                AND me.occurred_at  BETWEEN $4 AND $5
              GROUP BY fe.variant
            )
            SELECT e.variant, e.n, COALESCE(c.k, 0) AS k
            FROM exposed e
            LEFT JOIN converted c USING (variant)
            """;

        await using var conn = await _dataSource.OpenConnectionAsync(ct);
        await using var cmd = new NpgsqlCommand(sql, conn);
        cmd.Parameters.AddWithValue(NpgsqlDbType.Text, p.EnvId);
        cmd.Parameters.AddWithValue(NpgsqlDbType.Text, p.FlagKey);
        cmd.Parameters.AddWithValue(NpgsqlDbType.Text, p.ExperimentId);
        cmd.Parameters.AddWithValue(NpgsqlDbType.TimestampTz, p.Start);
        cmd.Parameters.AddWithValue(NpgsqlDbType.TimestampTz, p.End);
        cmd.Parameters.AddWithValue(NpgsqlDbType.Text, p.MetricEvent);

        var byVariant = new Dictionary<string, (long n, long k)>();
        await using var reader = await cmd.ExecuteReaderAsync(ct);
        while (await reader.ReadAsync(ct))
        {
            var variant = reader.GetString(0);
            var n = reader.GetInt64(1);
            var k = reader.GetInt64(2);
            byVariant[variant] = (n, k);
        }

        var ctrl = byVariant.GetValueOrDefault(p.ControlVariant);
        var trt = byVariant.GetValueOrDefault(p.TreatmentVariant);

        return new MetricSummary
        {
            MetricType = "binary",
            Control = new BinaryVariant { N = ctrl.n, K = ctrl.k },
            Treatment = new BinaryVariant { N = trt.n, K = trt.k },
        };
    }

    private async Task<MetricSummary> QueryContinuousAsync(ExperimentParams p, CancellationToken ct)
    {
        var aggExpr = AggFunction(p.MetricAgg);

        var sql = $"""
            WITH first_exposure AS (
              SELECT DISTINCT ON (user_key)
                user_key, variant, evaluated_at AS first_exposed_at
              FROM flag_evaluations
              WHERE env_id = $1
                AND flag_key = $2
                AND experiment_id = $3
                AND evaluated_at BETWEEN $4 AND $5
              ORDER BY user_key, evaluated_at ASC
            ),
            per_user AS (
              SELECT
                fe.variant,
                fe.user_key,
                {aggExpr} AS user_value
              FROM first_exposure fe
              JOIN metric_events me
                ON  me.user_key      = fe.user_key
                AND me.env_id        = $1
                AND me.event_name    = $6
                AND me.occurred_at  >= fe.first_exposed_at
                AND me.occurred_at  BETWEEN $4 AND $5
              WHERE me.numeric_value IS NOT NULL
              GROUP BY fe.variant, fe.user_key
            )
            SELECT
              variant,
              COUNT(*)              AS n,
              AVG(user_value)       AS mean,
              VAR_SAMP(user_value)  AS variance,
              SUM(user_value)       AS total
            FROM per_user
            GROUP BY variant
            """;

        await using var conn = await _dataSource.OpenConnectionAsync(ct);
        await using var cmd = new NpgsqlCommand(sql, conn);
        cmd.Parameters.AddWithValue(NpgsqlDbType.Text, p.EnvId);
        cmd.Parameters.AddWithValue(NpgsqlDbType.Text, p.FlagKey);
        cmd.Parameters.AddWithValue(NpgsqlDbType.Text, p.ExperimentId);
        cmd.Parameters.AddWithValue(NpgsqlDbType.TimestampTz, p.Start);
        cmd.Parameters.AddWithValue(NpgsqlDbType.TimestampTz, p.End);
        cmd.Parameters.AddWithValue(NpgsqlDbType.Text, p.MetricEvent);

        var byVariant = new Dictionary<string, ContinuousVariant>();
        await using var reader = await cmd.ExecuteReaderAsync(ct);
        while (await reader.ReadAsync(ct))
        {
            var variant = reader.GetString(0);
            byVariant[variant] = new ContinuousVariant
            {
                N = reader.GetInt64(1),
                Mean = reader.IsDBNull(2) ? 0 : reader.GetDouble(2),
                Variance = reader.IsDBNull(3) ? 0 : reader.GetDouble(3),
                Total = reader.IsDBNull(4) ? 0 : reader.GetDouble(4),
            };
        }

        var ctrl = byVariant.GetValueOrDefault(p.ControlVariant, new ContinuousVariant());
        var trt = byVariant.GetValueOrDefault(p.TreatmentVariant, new ContinuousVariant());

        return new MetricSummary
        {
            MetricType = p.MetricType,
            Control = ctrl,
            Treatment = trt,
        };
    }

    private static string AggFunction(string agg) => agg switch
    {
        "sum" => "SUM(me.numeric_value)",
        "mean" => "AVG(me.numeric_value)",
        "count" => "COUNT(me.numeric_value)",
        "latest" => "(ARRAY_AGG(me.numeric_value ORDER BY me.occurred_at DESC))[1]",
        "once" => "(ARRAY_AGG(me.numeric_value ORDER BY me.occurred_at ASC))[1]",
        _ => "SUM(me.numeric_value)",
    };
}

// ── Models ──────────────────────────────────────────────────────────────────

public sealed class ExperimentParams
{
    public required string Slug { get; init; }
    public required string ProjectId { get; init; }
    public required string EnvId { get; init; }
    public required string FlagKey { get; init; }
    public required string ExperimentId { get; init; }
    public required string MetricEvent { get; init; }
    public required string MetricType { get; init; }  // binary | revenue | count | duration
    public required string MetricAgg { get; init; }   // once | sum | mean | count | latest
    public required string ControlVariant { get; init; }
    public required string TreatmentVariant { get; init; }
    public required DateTimeOffset Start { get; init; }
    public required DateTimeOffset End { get; init; }
}

/// <summary>
/// Metric summary — fed to Python analyzer via stdin.
/// Mirrors the TypeScript MetricSummary interface.
/// </summary>
public sealed class MetricSummary
{
    [JsonPropertyName("metricType")]
    public required string MetricType { get; init; }

    [JsonPropertyName("control")]
    public required object Control { get; init; }

    [JsonPropertyName("treatment")]
    public required object Treatment { get; init; }
}

public sealed class BinaryVariant
{
    [JsonPropertyName("n")]
    public long N { get; init; }

    [JsonPropertyName("k")]
    public long K { get; init; }
}

public sealed class ContinuousVariant
{
    [JsonPropertyName("n")]
    public long N { get; init; }

    [JsonPropertyName("mean")]
    public double Mean { get; init; }

    [JsonPropertyName("variance")]
    public double Variance { get; init; }

    [JsonPropertyName("total")]
    public double Total { get; init; }
}
