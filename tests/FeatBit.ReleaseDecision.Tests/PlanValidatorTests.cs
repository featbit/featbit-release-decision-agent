using Core.Models;
using Core.Services;

namespace FeatBit.ReleaseDecision.Tests;

public sealed class PlanValidatorTests
{
    private readonly PlanValidator validator = new(new RecipeCatalog(), new MetricTemplateRegistry());

    [Fact]
    public void Validate_ReturnsNoErrors_ForValidAgentVariantPlan()
    {
        var plan = CreateValidPlan();
        var catalog = CreateValidCatalog();

        var errors = validator.Validate(plan, catalog);

        Assert.Empty(errors);
    }

    [Fact]
    public void Validate_ReturnsErrors_ForRecipeMetricMismatch()
    {
        var plan = CreateValidPlan();
        plan.PrimaryMetric = "avg_cost";

        var errors = validator.Validate(plan, CreateValidCatalog());

        Assert.Contains(errors, error => error.Contains("primary_metric must be 'task_success_rate'", StringComparison.Ordinal));
    }

    [Fact]
    public void Validate_ReturnsErrors_WhenRequiredColumnsAreMissing()
    {
        var plan = CreateValidPlan();
        var catalog = CreateValidCatalog();
        catalog.Tables[0].Columns.RemoveAll(column => string.Equals(column.Name, "latency_ms", StringComparison.OrdinalIgnoreCase));

        var errors = validator.Validate(plan, catalog);

        Assert.Contains(errors, error => error.Contains("missing required columns", StringComparison.Ordinal));
    }

    [Fact]
    public void Validate_ReturnsErrors_WhenVariantsAreDuplicated()
    {
        var plan = CreateValidPlan();
        plan.Variants = ["planner_a", "planner_a"];

        var errors = validator.Validate(plan, CreateValidCatalog());

        Assert.Contains(errors, error => error.Contains("variants must be distinct", StringComparison.Ordinal));
    }

    [Fact]
    public void Validate_ReturnsErrors_WhenTimeRangeIsInvalid()
    {
        var plan = CreateValidPlan();
        plan.TimeRange = new TimeRange
        {
            Start = "2026-03-07T00:00:00Z",
            End = "2026-03-01T00:00:00Z"
        };

        var errors = validator.Validate(plan, CreateValidCatalog());

        Assert.Contains(errors, error => error.Contains("time_range must be a valid range", StringComparison.Ordinal));
    }

    [Fact]
    public void Validate_ReturnsErrors_WhenCatalogKindDoesNotMatchPlan()
    {
        var plan = CreateValidPlan();
        var catalog = CreateValidCatalog();
        catalog.DataSourceKind = "clickhouse";

        var errors = validator.Validate(plan, catalog);

        Assert.Contains(errors, error => error.Contains("catalog data_source_kind does not match plan data_source_kind", StringComparison.Ordinal));
    }

    [Fact]
    public void Validate_ReturnsNoErrors_WhenRequiredColumnsAreProvidedThroughMappings()
    {
        var plan = CreateValidPlan();
        plan.Table = "public.agent_events";
        plan.ColumnMappings = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase)
        {
            ["decision_key"] = "experiment_key",
            ["variant"] = "variation",
            ["task_id"] = "request_id",
            ["success"] = "is_success",
            ["cost"] = "total_cost",
            ["latency_ms"] = "duration_ms",
            ["created_at"] = "observed_at"
        };

        var catalog = new DataCatalog
        {
            DataSourceKind = "postgres",
            Tables =
            [
                new TableSchema
                {
                    Name = "public.agent_events",
                    Columns =
                    [
                        new ColumnSchema { Name = "experiment_key", Type = "text" },
                        new ColumnSchema { Name = "variation", Type = "text" },
                        new ColumnSchema { Name = "request_id", Type = "text" },
                        new ColumnSchema { Name = "is_success", Type = "boolean" },
                        new ColumnSchema { Name = "total_cost", Type = "numeric" },
                        new ColumnSchema { Name = "duration_ms", Type = "integer" },
                        new ColumnSchema { Name = "observed_at", Type = "timestamp with time zone" }
                    ]
                }
            ],
            MetricCandidates = ["task_success_rate", "avg_cost", "p95_latency_ms"]
        };

        var errors = validator.Validate(plan, catalog);

        Assert.Empty(errors);
    }

    private static ExperimentPlan CreateValidPlan()
    {
        return new ExperimentPlan
        {
            RecipeId = "agent_variant_comparison",
            DecisionKey = "coding_agent_planner",
            Variants = ["planner_a", "planner_b"],
            RandomizationUnit = "task_id",
            PrimaryMetric = "task_success_rate",
            Guardrails = ["avg_cost", "p95_latency_ms"],
            RolloutPercentage = 10,
            DataSourceKind = "postgres",
            Table = "public.decision_events",
            TimeRange = new TimeRange
            {
                Start = "2026-03-01T00:00:00Z",
                End = "2026-03-07T00:00:00Z"
            }
        };
    }

    private static DataCatalog CreateValidCatalog()
    {
        return new DataCatalog
        {
            DataSourceKind = "postgres",
            Tables =
            [
                new TableSchema
                {
                    Name = "public.decision_events",
                    Columns =
                    [
                        new ColumnSchema { Name = "decision_key", Type = "text" },
                        new ColumnSchema { Name = "variant", Type = "text" },
                        new ColumnSchema { Name = "task_id", Type = "text" },
                        new ColumnSchema { Name = "success", Type = "boolean" },
                        new ColumnSchema { Name = "cost", Type = "numeric" },
                        new ColumnSchema { Name = "latency_ms", Type = "integer" },
                        new ColumnSchema { Name = "created_at", Type = "timestamp with time zone" }
                    ]
                }
            ],
            MetricCandidates = ["task_success_rate", "avg_cost", "p95_latency_ms"]
        };
    }
}