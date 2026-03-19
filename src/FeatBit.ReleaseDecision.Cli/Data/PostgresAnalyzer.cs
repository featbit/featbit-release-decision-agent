using Npgsql;
using FeatBit.ReleaseDecision.Cli.Models;

namespace FeatBit.ReleaseDecision.Cli.Data;

public sealed record VariantMetrics(
    string Variant,
    double TaskSuccessRate,
    double AvgCost,
    double P95LatencyMs);

/// <summary>
/// Executes metric queries against PostgreSQL and returns per-variant results.
/// Column names used in queries come exclusively from catalog inspection or explicit
/// column_mappings — never raw user input — so quoting them is sufficient to prevent injection.
/// </summary>
public sealed class PostgresAnalyzer(string connectionString)
{
    public async Task<VariantMetrics[]> AnalyzeAsync(
        PlanJson plan,
        CatalogJson catalog,
        CancellationToken ct = default)
    {
        var tableEntry = catalog.Tables.FirstOrDefault(
            t => t.Name.Equals(plan.Table, StringComparison.OrdinalIgnoreCase))
            ?? throw new InvalidOperationException(
                $"Table '{plan.Table}' not found in catalog. Run 'inspect' first or check your plan.");

        var availableColumns = tableEntry.Columns.Select(c => c.Name).ToArray();

        if (!ColumnResolver.TryResolve("variant", plan.ColumnMappings, availableColumns, out var variantCol))
            throw new InvalidOperationException("Cannot resolve 'variant' column. Add a column_mappings entry.");
        if (!ColumnResolver.TryResolve("success", plan.ColumnMappings, availableColumns, out var successCol))
            throw new InvalidOperationException("Cannot resolve 'success' column. Add a column_mappings entry.");
        if (!ColumnResolver.TryResolve("cost", plan.ColumnMappings, availableColumns, out var costCol))
            throw new InvalidOperationException("Cannot resolve 'cost' column. Add a column_mappings entry.");
        if (!ColumnResolver.TryResolve("latency_ms", plan.ColumnMappings, availableColumns, out var latencyCol))
            throw new InvalidOperationException("Cannot resolve 'latency_ms' column. Add a column_mappings entry.");
        if (!ColumnResolver.TryResolve("timestamp", plan.ColumnMappings, availableColumns, out var timestampCol))
            throw new InvalidOperationException("Cannot resolve 'timestamp' column. Add a column_mappings entry.");
        if (!ColumnResolver.TryResolve("decision_key", plan.ColumnMappings, availableColumns, out var decisionKeyCol))
            throw new InvalidOperationException("Cannot resolve 'decision_key' column. Add a column_mappings entry.");

        // Split schema.table for safe quoting
        var (schemaQ, tableQ) = QuoteTable(plan.Table);

        // Column names come from catalog schema inspection — quote them to prevent injection
        var sql = $"""
            SELECT
                "{variantCol}" AS variant,
                COUNT(*) FILTER (WHERE "{successCol}" = true)::float8
                    / NULLIF(COUNT(*), 0)                            AS task_success_rate,
                AVG("{costCol}"::float8)                             AS avg_cost,
                PERCENTILE_CONT(0.95) WITHIN GROUP
                    (ORDER BY "{latencyCol}"::float8)                AS p95_latency_ms
            FROM {schemaQ}.{tableQ}
            WHERE "{decisionKeyCol}" = @decision_key
              AND "{variantCol}" IN (@v1, @v2)
              AND "{timestampCol}" >= @start
              AND "{timestampCol}" <  @end
            GROUP BY "{variantCol}"
            """;

        await using var dataSource = NpgsqlDataSource.Create(connectionString);
        await using var conn = await dataSource.OpenConnectionAsync(ct);
        await using var cmd = new NpgsqlCommand(sql, conn);

        cmd.Parameters.AddWithValue("decision_key", plan.DecisionKey);
        cmd.Parameters.AddWithValue("v1", plan.Variants[0]);
        cmd.Parameters.AddWithValue("v2", plan.Variants[1]);
        cmd.Parameters.AddWithValue("start", NpgsqlTypes.NpgsqlDbType.TimestampTz,
            DateTime.Parse(plan.TimeRange.Start, null, System.Globalization.DateTimeStyles.RoundtripKind));
        cmd.Parameters.AddWithValue("end", NpgsqlTypes.NpgsqlDbType.TimestampTz,
            DateTime.Parse(plan.TimeRange.End, null, System.Globalization.DateTimeStyles.RoundtripKind));

        var results = new List<VariantMetrics>();
        await using var reader = await cmd.ExecuteReaderAsync(ct);
        while (await reader.ReadAsync(ct))
        {
            results.Add(new VariantMetrics(
                Variant: reader.GetString(0),
                TaskSuccessRate: reader.IsDBNull(1) ? 0.0 : reader.GetDouble(1),
                AvgCost: reader.IsDBNull(2) ? 0.0 : reader.GetDouble(2),
                P95LatencyMs: reader.IsDBNull(3) ? 0.0 : reader.GetDouble(3)));
        }

        return [.. results];
    }

    // Splits "schema.table" → ("\"schema\"", "\"table\"").
    // Falls back to ("public", "\"table\"") if no schema prefix is given.
    private static (string schemaQ, string tableQ) QuoteTable(string table)
    {
        var dot = table.IndexOf('.');
        if (dot < 0)
            return ("\"public\"", $"\"{table}\"");

        var schema = table[..dot];
        var tbl = table[(dot + 1)..];
        return ($"\"{schema}\"", $"\"{tbl}\"");
    }
}
