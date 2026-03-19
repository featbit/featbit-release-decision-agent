using Npgsql;
using FeatBit.ReleaseDecision.Cli.Models;

namespace FeatBit.ReleaseDecision.Cli.Data;

/// <summary>
/// Connects to a PostgreSQL instance and produces a catalog.json describing the schema.
/// </summary>
public sealed class PostgresInspector(string connectionString)
{
    public async Task<CatalogJson> InspectAsync(CancellationToken ct = default)
    {
        await using var dataSource = NpgsqlDataSource.Create(connectionString);
        await using var conn = await dataSource.OpenConnectionAsync(ct);

        const string sql = """
            SELECT table_schema, table_name, column_name, data_type
            FROM information_schema.columns
            WHERE table_schema NOT IN ('pg_catalog', 'information_schema')
            ORDER BY table_schema, table_name, ordinal_position
            """;

        var tableMap = new Dictionary<string, List<CatalogColumn>>(StringComparer.OrdinalIgnoreCase);

        await using var cmd = new NpgsqlCommand(sql, conn);
        await using var reader = await cmd.ExecuteReaderAsync(ct);

        while (await reader.ReadAsync(ct))
        {
            var schema = reader.GetString(0);
            var table = reader.GetString(1);
            var column = reader.GetString(2);
            var dataType = reader.GetString(3);

            var key = $"{schema}.{table}";
            if (!tableMap.TryGetValue(key, out var cols))
            {
                cols = [];
                tableMap[key] = cols;
            }
            cols.Add(new CatalogColumn { Name = column, Type = MapPgType(dataType) });
        }

        var tables = tableMap
            .Select(kv => new CatalogTable { Name = kv.Key, Columns = [.. kv.Value] })
            .ToArray();

        var metricCandidates = tables
            .Where(t => IsMetricCandidate(t.Columns))
            .Select(t => t.Name)
            .ToArray();

        return new CatalogJson
        {
            DataSourceKind = "postgres",
            Tables = tables,
            MetricCandidates = metricCandidates
        };
    }

    // A table is a metric candidate if ≥2 of its columns match known canonical field names.
    private static bool IsMetricCandidate(CatalogColumn[] columns)
    {
        int matches = 0;
        foreach (var col in columns)
        {
            if (ColumnResolver.KnownCanonicals.Contains(col.Name, StringComparer.OrdinalIgnoreCase))
                matches++;
        }
        return matches >= 2;
    }

    private static string MapPgType(string pgType) => pgType switch
    {
        "integer" or "bigint" or "smallint" => "integer",
        "numeric" or "real" or "double precision" => "numeric",
        "boolean" => "boolean",
        "character varying" or "varchar" or "text" or "char" => "text",
        "timestamp without time zone" or "timestamp with time zone" => "timestamp",
        "date" => "date",
        "uuid" => "uuid",
        _ => pgType
    };
}
