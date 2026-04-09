using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;
using System.Text.RegularExpressions;
using Npgsql;
using NpgsqlTypes;

namespace FRD.DataServer.Services;

/// <summary>
/// Collects metric data from event tables for a single experiment,
/// returning a MetricSummary (binary or continuous) ready for analysis.
///
/// Fixed parameter layout (set by BuildExposureQuery):
///   $1  envId         TEXT
///   $2  flagKey       TEXT
///   $3  experimentId  TEXT  nullable — NULL skips experiment filter
///   $4  layerId       TEXT  nullable — NULL skips layer filter
///   $5  trafficPct    INT   0–100, 100 disables hash-based sampling
///   $6  trafficOff    INT   0–99, bucket start (default 0)
///   $7  start         TIMESTAMPTZ
///   $8  end           TIMESTAMPTZ
///   $9+ audience filter values (variable, depending on AudienceFilters)
///   $N  metricEvent   TEXT  — appended last by caller
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

    // ── Query methods ─────────────────────────────────────────────────────────

    private async Task<MetricSummary> QueryBinaryAsync(ExperimentParams p, CancellationToken ct)
    {
        var (exposureCtes, cmd) = BuildExposureQuery(p);
        int metricParam = cmd.Parameters.Count + 1;

        cmd.CommandText = $"""
            WITH {exposureCtes},
            exposed AS (
              SELECT variant, COUNT(*) AS n
              FROM exposure
              GROUP BY variant
            ),
            converted AS (
              SELECT fe.variant, COUNT(DISTINCT fe.user_key) AS k
              FROM exposure fe
              JOIN metric_events me
                ON  me.user_key      = fe.user_key
                AND me.env_id        = $1
                AND me.event_name    = ${metricParam}
                AND me.occurred_at  >= fe.first_exposed_at
                AND me.occurred_at  BETWEEN $7 AND $8
              GROUP BY fe.variant
            )
            SELECT e.variant, e.n, COALESCE(c.k, 0) AS k
            FROM exposed e
            LEFT JOIN converted c USING (variant)
            """;
        cmd.Parameters.AddWithValue(NpgsqlDbType.Text, p.MetricEvent); // $metricParam

        await using var conn = await _dataSource.OpenConnectionAsync(ct);
        cmd.Connection = conn;

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
        var (exposureCtes, cmd) = BuildExposureQuery(p);
        int metricParam = cmd.Parameters.Count + 1;

        cmd.CommandText = $"""
            WITH {exposureCtes},
            per_user AS (
              SELECT
                fe.variant,
                fe.user_key,
                {aggExpr} AS user_value
              FROM exposure fe
              JOIN metric_events me
                ON  me.user_key      = fe.user_key
                AND me.env_id        = $1
                AND me.event_name    = ${metricParam}
                AND me.occurred_at  >= fe.first_exposed_at
                AND me.occurred_at  BETWEEN $7 AND $8
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
        cmd.Parameters.AddWithValue(NpgsqlDbType.Text, p.MetricEvent); // $metricParam

        await using var conn = await _dataSource.OpenConnectionAsync(ct);
        cmd.Connection = conn;

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

    // ── Query builder ─────────────────────────────────────────────────────────

    /// <summary>
    /// Builds the full CTE chain (first_exposure → exposure) and a pre-loaded NpgsqlCommand.
    /// first_exposure: raw per-user first evaluation (may be unbalanced across variants).
    /// exposure: balanced sampling — deterministic hash-based downsampling so each variant
    /// has equal N = min(n_control, n_treatment), enabling fair A/B comparison.
    /// Caller wraps as WITH {ctes}, ... and references the 'exposure' CTE.
    /// </summary>
    private static (string ctes, NpgsqlCommand cmd) BuildExposureQuery(ExperimentParams p)
    {
        var cmd = new NpgsqlCommand();

        // Fixed parameters $1–$8
        cmd.Parameters.AddWithValue(NpgsqlDbType.Text, p.EnvId);                            // $1
        cmd.Parameters.AddWithValue(NpgsqlDbType.Text, p.FlagKey);                          // $2
        cmd.Parameters.Add(new NpgsqlParameter                                              // $3
        {
            NpgsqlDbType = NpgsqlDbType.Text,
            Value = (object?)p.ExperimentId ?? DBNull.Value,
        });
        cmd.Parameters.Add(new NpgsqlParameter                                              // $4
        {
            NpgsqlDbType = NpgsqlDbType.Text,
            Value = (object?)p.LayerId ?? DBNull.Value,
        });
        cmd.Parameters.AddWithValue(NpgsqlDbType.Integer, (int)(p.TrafficPercent ?? 100)); // $5
        cmd.Parameters.AddWithValue(NpgsqlDbType.Integer, (int)(p.TrafficOffset ?? 0));    // $6
        cmd.Parameters.AddWithValue(NpgsqlDbType.TimestampTz, p.Start);                    // $7
        cmd.Parameters.AddWithValue(NpgsqlDbType.TimestampTz, p.End);                      // $8

        var sb = new StringBuilder();
        sb.AppendLine("first_exposure AS (");
        sb.AppendLine("  SELECT DISTINCT ON (user_key)");
        sb.AppendLine("    user_key, variant, evaluated_at AS first_exposed_at");
        sb.AppendLine("  FROM flag_evaluations");
        sb.AppendLine("  WHERE env_id = $1");
        sb.AppendLine("    AND flag_key = $2");
        sb.AppendLine("    AND ($3::text IS NULL OR experiment_id = $3)");
        sb.AppendLine("    AND ($4::text IS NULL OR layer_id = $4)");
        sb.AppendLine("    AND ($5 >= 100 OR (abs(hashtext(user_key || $2)) % 100 >= $6 AND abs(hashtext(user_key || $2)) % 100 < $6 + $5))");
        sb.AppendLine("    AND evaluated_at BETWEEN $7 AND $8");

        // Audience filter conditions — property names are sanitized; values are parameterized
        foreach (var f in ParseAudienceFilters(p.AudienceFilters))
        {
            // Allow only word characters (letters, digits, underscore) in property names
            if (!Regex.IsMatch(f.Property, @"^\w+$")) continue;

            int paramNum = cmd.Parameters.Count + 1;
            var colExpr = $"user_props->>'{f.Property}'";

            switch (f.Op)
            {
                case "eq":
                    cmd.Parameters.AddWithValue(NpgsqlDbType.Text, f.Value ?? "");
                    sb.AppendLine($"    AND {colExpr} = ${paramNum}");
                    break;
                case "neq":
                    cmd.Parameters.AddWithValue(NpgsqlDbType.Text, f.Value ?? "");
                    sb.AppendLine($"    AND ({colExpr} IS NULL OR {colExpr} != ${paramNum})");
                    break;
                case "in":
                    cmd.Parameters.AddWithValue(NpgsqlDbType.Array | NpgsqlDbType.Text,
                        f.Values?.ToArray() ?? []);
                    sb.AppendLine($"    AND {colExpr} = ANY(${paramNum}::text[])");
                    break;
                case "nin":
                    cmd.Parameters.AddWithValue(NpgsqlDbType.Array | NpgsqlDbType.Text,
                        f.Values?.ToArray() ?? []);
                    sb.AppendLine($"    AND ({colExpr} IS NULL OR NOT ({colExpr} = ANY(${paramNum}::text[])))");
                    break;
            }
        }

        sb.AppendLine("  ORDER BY user_key, evaluated_at ASC");
        sb.AppendLine("),");

        // Balanced sampling: only for A/B tests — downsample to equal N per variant.
        // Bandit keeps all data per arm (asymmetric allocation is intentional).
        if (p.Method is "bandit")
        {
            sb.AppendLine("exposure AS (");
            sb.AppendLine("  SELECT user_key, variant, first_exposed_at FROM first_exposure");
            sb.Append(")");
        }
        else
        {
            sb.AppendLine("exposure AS (");
            sb.AppendLine("  SELECT user_key, variant, first_exposed_at");
            sb.AppendLine("  FROM (");
            sb.AppendLine("    SELECT user_key, variant, first_exposed_at,");
            sb.AppendLine("      ROW_NUMBER() OVER (PARTITION BY variant ORDER BY abs(hashtext(user_key))) AS rn");
            sb.AppendLine("    FROM first_exposure");
            sb.AppendLine("  ) ranked");
            sb.AppendLine("  WHERE rn <= (SELECT MIN(c) FROM (SELECT COUNT(*) AS c FROM first_exposure GROUP BY variant) vc)");
            sb.Append(")");
        }

        return (sb.ToString(), cmd);
    }

    private static readonly JsonSerializerOptions FilterJsonOpts = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
    };

    private static List<AudienceFilterEntry> ParseAudienceFilters(string? json)
    {
        if (string.IsNullOrWhiteSpace(json)) return [];
        try { return JsonSerializer.Deserialize<List<AudienceFilterEntry>>(json, FilterJsonOpts) ?? []; }
        catch { return []; }
    }

    private static string AggFunction(string agg) => agg switch
    {
        "sum"    => "SUM(me.numeric_value)",
        "mean"   => "AVG(me.numeric_value)",
        "count"  => "COUNT(me.numeric_value)",
        "latest" => "(ARRAY_AGG(me.numeric_value ORDER BY me.occurred_at DESC))[1]",
        "once"   => "(ARRAY_AGG(me.numeric_value ORDER BY me.occurred_at ASC))[1]",
        _        => "SUM(me.numeric_value)",
    };
}

// ── Filter model ─────────────────────────────────────────────────────────────

/// <summary>
/// One audience filter rule. Serialized as JSON in Experiment.audienceFilters.
/// e.g. {"property":"plan","op":"in","values":["premium","enterprise"]}
/// </summary>
public sealed class AudienceFilterEntry
{
    public string Property { get; set; } = "";
    public string Op { get; set; } = "eq";   // eq | neq | in | nin
    public string? Value { get; set; }        // for eq / neq
    public List<string>? Values { get; set; } // for in / nin
}

// ── Experiment params ─────────────────────────────────────────────────────────

public sealed class ExperimentParams
{
    public required string Slug { get; init; }
    public required string ProjectId { get; init; }
    public required string EnvId { get; init; }
    public required string FlagKey { get; init; }
    public required string Method { get; init; }        // bayesian_ab | bandit
    public string? ExperimentId { get; init; }           // matches flag_evaluations.experiment_id; null = no filter
    public string? LayerId { get; init; }                // mutual-exclusion layer
    public double? TrafficPercent { get; init; }         // 0–100; null = 100 (all users)
    public int? TrafficOffset { get; init; }              // 0–99; null = 0 (bucket starts at 0)
    public string? AudienceFilters { get; init; }        // JSON: AudienceFilterEntry[]
    public required string MetricEvent { get; init; }
    public required string MetricType { get; init; }     // binary | revenue | count | duration
    public required string MetricAgg { get; init; }      // once | sum | mean | count | latest
    public required string ControlVariant { get; init; }
    public required string TreatmentVariant { get; init; }
    public required DateTimeOffset Start { get; init; }
    public required DateTimeOffset End { get; init; }
}

// ── Metric summary models ─────────────────────────────────────────────────────

/// <summary>Metric summary — fed to Python analyzer via stdin.</summary>
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
    [JsonPropertyName("n")] public long N { get; init; }
    [JsonPropertyName("k")] public long K { get; init; }
}

public sealed class ContinuousVariant
{
    [JsonPropertyName("n")]        public long   N        { get; init; }
    [JsonPropertyName("mean")]     public double Mean     { get; init; }
    [JsonPropertyName("variance")] public double Variance { get; init; }
    [JsonPropertyName("total")]    public double Total    { get; init; }
}

