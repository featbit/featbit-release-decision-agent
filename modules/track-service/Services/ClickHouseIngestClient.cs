using System.Data;
using ClickHouse.Client.ADO;
using ClickHouse.Client.Copy;
using FeatBit.TrackService.Models;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;

namespace FeatBit.TrackService.Services;

/// <summary>
/// Thin wrapper around ClickHouseBulkCopy that takes a List&lt;EventRecord&gt;
/// from the batch worker and INSERTs it into the right table.
/// </summary>
public sealed class ClickHouseIngestClient(
    IOptions<ClickHouseOptions> opts,
    ILogger<ClickHouseIngestClient> log)
{
    private readonly ClickHouseOptions _cfg = opts.Value;

    public async Task InsertFlagEvaluationsAsync(IReadOnlyList<EventRecord> rows, CancellationToken ct)
    {
        if (rows.Count == 0) return;

        await using var conn = new ClickHouseConnection(_cfg.ConnectionString);
        await conn.OpenAsync(ct);

        using var bulk = new ClickHouseBulkCopy(conn)
        {
            DestinationTableName = $"{_cfg.Database}.{_cfg.FlagEvaluationsTable}",
            ColumnNames           = new[]
            {
                "env_id", "flag_key", "user_key", "variant",
                "experiment_id", "layer_id", "hash_bucket",
                "timestamp", "user_properties",
            },
            BatchSize = rows.Count,
        };
        await bulk.InitAsync();

        var data = new object?[rows.Count][];
        for (int i = 0; i < rows.Count; i++)
        {
            var r = rows[i];
            data[i] = new object?[]
            {
                r.EnvId,
                r.FlagKey      ?? "",
                r.UserKey,
                r.Variant      ?? "",
                r.ExperimentId,            // Nullable(String)
                r.LayerId,                 // Nullable(String)
                r.HashBucket,
                r.Timestamp,
                r.UserPropsJson,
            };
        }

        await bulk.WriteToServerAsync(data, ct);
        log.LogDebug("ClickHouse INSERT flag_evaluations rows={Rows}", rows.Count);
    }

    public async Task InsertMetricEventsAsync(IReadOnlyList<EventRecord> rows, CancellationToken ct)
    {
        if (rows.Count == 0) return;

        await using var conn = new ClickHouseConnection(_cfg.ConnectionString);
        await conn.OpenAsync(ct);

        using var bulk = new ClickHouseBulkCopy(conn)
        {
            DestinationTableName = $"{_cfg.Database}.{_cfg.MetricEventsTable}",
            ColumnNames           = new[]
            {
                "env_id", "event_name", "user_key",
                "numeric_value", "timestamp", "user_properties",
            },
            BatchSize = rows.Count,
        };
        await bulk.InitAsync();

        var data = new object?[rows.Count][];
        for (int i = 0; i < rows.Count; i++)
        {
            var r = rows[i];
            data[i] = new object?[]
            {
                r.EnvId,
                r.EventName ?? "",
                r.UserKey,
                r.NumericValue,            // Nullable(Float64)
                r.Timestamp,
                r.UserPropsJson,
            };
        }

        await bulk.WriteToServerAsync(data, ct);
        log.LogDebug("ClickHouse INSERT metric_events rows={Rows}", rows.Count);
    }
}
