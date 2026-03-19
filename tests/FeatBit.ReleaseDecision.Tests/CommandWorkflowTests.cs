using Core.Models;
using Core.Services;
using DecisionCli.Commands;

namespace FeatBit.ReleaseDecision.Tests;

public sealed class CommandWorkflowTests
{
    private readonly FileStore fileStore = new();
    private readonly PlanValidator planValidator = new(new RecipeCatalog(), new MetricTemplateRegistry());
    private readonly RecommendationEngine recommendationEngine = new();
    private readonly SummaryWriter summaryWriter = new();

    [Fact]
    public async Task ValidatePlanCommand_ReturnsSuccess_ForValidPlanAndCatalog()
    {
        using var sandbox = new TestSandbox();
        var planPath = sandbox.PathFor("plan.json");
        var catalogPath = sandbox.PathFor("catalog.json");

        await fileStore.WriteJsonAsync(planPath, CreateValidPlan());
        await fileStore.WriteJsonAsync(catalogPath, CreateValidCatalog());

        var command = new ValidatePlanCommand(fileStore, planValidator);

        var exitCode = await command.ExecuteAsync(new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase)
        {
            ["plan"] = planPath,
            ["catalog"] = catalogPath
        });

        Assert.Equal(0, exitCode);
    }

    [Fact]
    public async Task ValidatePlanCommand_ReturnsFailure_ForInvalidPlan()
    {
        using var sandbox = new TestSandbox();
        var planPath = sandbox.PathFor("plan.json");
        var catalogPath = sandbox.PathFor("catalog.json");
        var invalidPlan = CreateValidPlan();
        invalidPlan.Variants = ["baseline", "baseline"];

        await fileStore.WriteJsonAsync(planPath, invalidPlan);
        await fileStore.WriteJsonAsync(catalogPath, CreateValidCatalog());

        var command = new ValidatePlanCommand(fileStore, planValidator);

        var exitCode = await command.ExecuteAsync(new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase)
        {
            ["plan"] = planPath,
            ["catalog"] = catalogPath
        });

        Assert.Equal(1, exitCode);
    }

    [Fact]
    public async Task InspectCommand_WritesCatalog_UsingConnectionEnv()
    {
        using var sandbox = new TestSandbox();
        var outputPath = sandbox.PathFor("catalog.json");
        var envVarName = $"FB_DECISION_TEST_{Guid.NewGuid():N}";
        var expectedConnection = "Host=test;Database=decision;Username=demo;Password=demo";
        Environment.SetEnvironmentVariable(envVarName, expectedConnection);

        try
        {
            var adapter = new FakeDataSourceAdapter
            {
                InspectCatalog = CreateValidCatalog()
            };

            var command = new InspectCommand(new Dictionary<string, IDataSourceAdapter>(StringComparer.OrdinalIgnoreCase)
            {
                ["postgres"] = adapter
            }, fileStore);

            var exitCode = await command.ExecuteAsync(new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase)
            {
                ["data-source-kind"] = "postgres",
                ["connection-env"] = envVarName,
                ["out"] = outputPath
            });

            var writtenCatalog = await fileStore.ReadJsonAsync<DataCatalog>(outputPath);

            Assert.Equal(0, exitCode);
            Assert.Equal(expectedConnection, adapter.LastConnectionString);
            Assert.Equal("postgres", writtenCatalog.DataSourceKind);
        }
        finally
        {
            Environment.SetEnvironmentVariable(envVarName, null);
        }
    }

    [Fact]
    public async Task InspectCommand_Throws_WhenConnectionEnvMissing()
    {
        using var sandbox = new TestSandbox();
        var outputPath = sandbox.PathFor("catalog.json");
        var command = new InspectCommand(new Dictionary<string, IDataSourceAdapter>(StringComparer.OrdinalIgnoreCase)
        {
            ["postgres"] = new FakeDataSourceAdapter { InspectCatalog = CreateValidCatalog() }
        }, fileStore);

        var exception = await Assert.ThrowsAsync<InvalidOperationException>(() => command.ExecuteAsync(new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase)
        {
            ["data-source-kind"] = "postgres",
            ["connection-env"] = "FB_DECISION_ENV_DOES_NOT_EXIST",
            ["out"] = outputPath
        }));

        Assert.Contains("was not found or is empty", exception.Message, StringComparison.Ordinal);
    }

    [Fact]
    public async Task RunCommand_WritesResultsAndSummary_UsingAdapterOutput()
    {
        using var sandbox = new TestSandbox();
        var planPath = sandbox.PathFor("plan.json");
        var catalogPath = sandbox.PathFor("catalog.json");
        var resultsPath = sandbox.PathFor("results.json");
        var summaryPath = sandbox.PathFor("summary.md");

        await fileStore.WriteJsonAsync(planPath, CreateValidPlan());
        await fileStore.WriteJsonAsync(catalogPath, CreateValidCatalog());

        var adapter = new FakeDataSourceAdapter
        {
            RunResult = new EvaluationResult
            {
                RecipeId = "agent_variant_comparison",
                DecisionKey = "coding_agent_planner",
                PrimaryMetric = new MetricEvaluation
                {
                    Name = "task_success_rate",
                    BaselineVariant = "baseline",
                    CandidateVariant = "candidate",
                    BaselineValue = 0.50,
                    CandidateValue = 0.60,
                    AbsoluteDelta = 0.10,
                    RelativeDelta = 0.20
                },
                Guardrails =
                [
                    new GuardrailEvaluation
                    {
                        Name = "avg_cost",
                        BaselineValue = 1.0,
                        CandidateValue = 1.01,
                        RelativeDelta = 0.01,
                        Status = "pass"
                    }
                ]
            }
        };

        var command = new RunCommand(
            fileStore,
            new Dictionary<string, IDataSourceAdapter>(StringComparer.OrdinalIgnoreCase) { ["postgres"] = adapter },
            recommendationEngine,
            summaryWriter);

        var exitCode = await command.ExecuteAsync(new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase)
        {
            ["plan"] = planPath,
            ["catalog"] = catalogPath,
            ["connection"] = "Host=localhost;Database=decision",
            ["out"] = resultsPath,
            ["summary-out"] = summaryPath
        });

        var writtenResult = await fileStore.ReadJsonAsync<EvaluationResult>(resultsPath);
        var summary = await File.ReadAllTextAsync(summaryPath);

        Assert.Equal(0, exitCode);
        Assert.Equal("Host=localhost;Database=decision", adapter.LastConnectionString);
        Assert.Equal(RecommendationNames.Continue, writtenResult.Recommendation);
        Assert.Equal(25, writtenResult.RecommendedNextRolloutPercentage);
        Assert.Contains("Continue rollout to **25%**.", summary, StringComparison.Ordinal);
    }

    private static ExperimentPlan CreateValidPlan()
    {
        return new ExperimentPlan
        {
            RecipeId = "agent_variant_comparison",
            DecisionKey = "coding_agent_planner",
            Variants = ["baseline", "candidate"],
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

    private sealed class FakeDataSourceAdapter : IDataSourceAdapter
    {
        public string Kind => "postgres";

        public DataCatalog InspectCatalog { get; set; } = new();

        public EvaluationResult RunResult { get; set; } = new();

        public string? LastConnectionString { get; private set; }

        public Task<DataCatalog> InspectAsync(string connectionString, CancellationToken cancellationToken = default)
        {
            LastConnectionString = connectionString;
            return Task.FromResult(InspectCatalog);
        }

        public Task<EvaluationResult> RunAsync(string connectionString, ExperimentPlan plan, CancellationToken cancellationToken = default)
        {
            LastConnectionString = connectionString;
            return Task.FromResult(RunResult);
        }
    }

    private sealed class TestSandbox : IDisposable
    {
        private readonly string rootPath = Path.Combine(Path.GetTempPath(), "featbit-release-decision-tests", Guid.NewGuid().ToString("N"));

        public TestSandbox()
        {
            Directory.CreateDirectory(rootPath);
        }

        public string PathFor(string fileName) => Path.Combine(rootPath, fileName);

        public void Dispose()
        {
            if (Directory.Exists(rootPath))
            {
                Directory.Delete(rootPath, recursive: true);
            }
        }
    }
}