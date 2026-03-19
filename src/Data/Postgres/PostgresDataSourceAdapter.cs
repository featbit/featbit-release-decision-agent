using Core.Models;
using Core.Services;
using Npgsql;

namespace Data.Postgres;

public sealed class PostgresDataSourceAdapter : IDataSourceAdapter
{
    private readonly PostgresConnectionFactory connectionFactory;
    private readonly SqlTemplateLoader sqlTemplateLoader;

    public PostgresDataSourceAdapter(PostgresConnectionFactory connectionFactory, SqlTemplateLoader sqlTemplateLoader)
    {
        this.connectionFactory = connectionFactory;
        this.sqlTemplateLoader = sqlTemplateLoader;
    }

    public string Kind => "postgres";

    public async Task<DataCatalog> InspectAsync(string connectionString, CancellationToken cancellationToken = default)
    {
        await using var connection = connectionFactory.Create(connectionString);
        await connection.OpenAsync(cancellationToken);

        const string sql = @"
SELECT
    table_schema,
    table_name,
    column_name,
    data_type
FROM information_schema.columns
WHERE table_schema NOT IN ('information_schema', 'pg_catalog')
ORDER BY table_schema, table_name, ordinal_position;";

        await using var command = new NpgsqlCommand(sql, connection);
        await using var reader = await command.ExecuteReaderAsync(cancellationToken);

        var tableMap = new Dictionary<string, TableSchema>(StringComparer.OrdinalIgnoreCase);

        while (await reader.ReadAsync(cancellationToken))
        {
            var schema = reader.GetString(0);
            var tableName = reader.GetString(1);
            var columnName = reader.GetString(2);
            var dataType = reader.GetString(3);
            var qualifiedTableName = $"{schema}.{tableName}";

            if (!tableMap.TryGetValue(qualifiedTableName, out var table))
            {
                table = new TableSchema { Name = qualifiedTableName };
                tableMap[qualifiedTableName] = table;
            }

            table.Columns.Add(new ColumnSchema
            {
                Name = columnName,
                Type = dataType
            });
        }

        return new DataCatalog
        {
            DataSourceKind = Kind,
            Tables = tableMap.Values.ToList(),
            MetricCandidates = ["task_success_rate", "avg_cost", "p95_latency_ms"]
        };
    }

    public async Task<EvaluationResult> RunAsync(string connectionString, ExperimentPlan plan, CancellationToken cancellationToken = default)
    {
        await using var connection = connectionFactory.Create(connectionString);
        await connection.OpenAsync(cancellationToken);

        var baselineVariant = plan.Variants.FirstOrDefault() ?? "baseline";
        var candidateVariant = plan.Variants.Skip(1).FirstOrDefault() ?? "candidate";
        var baselinePrimaryValue = await RunMetricAsync(connection, plan, plan.PrimaryMetric, baselineVariant, cancellationToken);
        var candidatePrimaryValue = await RunMetricAsync(connection, plan, plan.PrimaryMetric, candidateVariant, cancellationToken);
        var guardrails = new List<GuardrailEvaluation>();

        foreach (var guardrailName in plan.Guardrails)
        {
            var baselineGuardrailValue = await RunMetricAsync(connection, plan, guardrailName, baselineVariant, cancellationToken);
            var candidateGuardrailValue = await RunMetricAsync(connection, plan, guardrailName, candidateVariant, cancellationToken);
            var guardrailRelativeDelta = CalculateRelativeDelta(baselineGuardrailValue, candidateGuardrailValue);

            guardrails.Add(new GuardrailEvaluation
            {
                Name = guardrailName,
                BaselineValue = baselineGuardrailValue,
                CandidateValue = candidateGuardrailValue,
                RelativeDelta = guardrailRelativeDelta,
                Status = EvaluateGuardrailStatus(guardrailName, guardrailRelativeDelta)
            });
        }

        return new EvaluationResult
        {
            RecipeId = plan.RecipeId,
            DecisionKey = plan.DecisionKey,
            PrimaryMetric = new MetricEvaluation
            {
                Name = plan.PrimaryMetric,
                BaselineVariant = baselineVariant,
                CandidateVariant = candidateVariant,
                BaselineValue = baselinePrimaryValue,
                CandidateValue = candidatePrimaryValue,
                AbsoluteDelta = candidatePrimaryValue - baselinePrimaryValue,
                RelativeDelta = CalculateRelativeDelta(baselinePrimaryValue, candidatePrimaryValue)
            },
            Guardrails = guardrails,
            Reasoning = []
        };
    }

    private async Task<double> RunMetricAsync(NpgsqlConnection connection, ExperimentPlan plan, string metricName, string variant, CancellationToken cancellationToken)
    {
        var template = sqlTemplateLoader.Load(plan.DataSourceKind, metricName);
        var sql = template.Replace("{{table}}", QuoteQualifiedIdentifier(plan.Table), StringComparison.Ordinal);

        await using var command = new NpgsqlCommand(sql, connection);
        command.Parameters.AddWithValue("decision_key", plan.DecisionKey);
        command.Parameters.AddWithValue("variant", variant);
        command.Parameters.AddWithValue("start", DateTimeOffset.Parse(plan.TimeRange.Start));
        command.Parameters.AddWithValue("end", DateTimeOffset.Parse(plan.TimeRange.End));

        var value = await command.ExecuteScalarAsync(cancellationToken);
        if (value is null || value is DBNull)
        {
            return 0;
        }

        return Convert.ToDouble(value);
    }

    private static double CalculateRelativeDelta(double baselineValue, double candidateValue)
    {
        if (baselineValue == 0)
        {
            return candidateValue == 0 ? 0 : 1;
        }

        return (candidateValue - baselineValue) / baselineValue;
    }

    private static string EvaluateGuardrailStatus(string guardrailName, double relativeDelta)
    {
        return guardrailName.ToLowerInvariant() switch
        {
            "avg_cost" when relativeDelta > 0.05 => "fail",
            "p95_latency_ms" when relativeDelta > 0.10 => "fail",
            _ => "pass"
        };
    }

    private static string QuoteQualifiedIdentifier(string identifier)
    {
        return string.Join('.', identifier.Split('.', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries).Select(part => $"\"{part.Replace("\"", "\"\"")}\""));
    }
}