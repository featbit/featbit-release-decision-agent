using Core.Models;
using Core.Services;

namespace DecisionCli.Commands;

public sealed class RunCommand : ICommandHandler
{
    private readonly FileStore fileStore;
    private readonly IReadOnlyDictionary<string, IDataSourceAdapter> adapters;
    private readonly RecommendationEngine recommendationEngine;
    private readonly SummaryWriter summaryWriter;

    public RunCommand(FileStore fileStore, IReadOnlyDictionary<string, IDataSourceAdapter> adapters, RecommendationEngine recommendationEngine, SummaryWriter summaryWriter)
    {
        this.fileStore = fileStore;
        this.adapters = adapters;
        this.recommendationEngine = recommendationEngine;
        this.summaryWriter = summaryWriter;
    }

    public string Name => "run";

    public async Task<int> ExecuteAsync(IReadOnlyDictionary<string, string> options, CancellationToken cancellationToken = default)
    {
        var planPath = GetRequiredOption(options, "plan");
        var catalogPath = GetRequiredOption(options, "catalog");
        var connection = ConnectionResolver.Resolve(options);
        var outputPath = GetRequiredOption(options, "out");
        var summaryPath = GetOptionalOption(options, "summary-out") ?? GetDefaultSummaryPath(outputPath);

        ExperimentPlan plan = await fileStore.ReadJsonAsync<ExperimentPlan>(planPath, cancellationToken);
        _ = await fileStore.ReadJsonAsync<DataCatalog>(catalogPath, cancellationToken);

        if (!adapters.TryGetValue(plan.DataSourceKind, out var adapter))
        {
            throw new InvalidOperationException($"Unsupported data source kind '{plan.DataSourceKind}'.");
        }

        EvaluationResult evaluationResult = await adapter.RunAsync(connection, plan, cancellationToken);
        EvaluationResult enrichedResult = recommendationEngine.Apply(evaluationResult, plan.RolloutPercentage);

        await fileStore.WriteJsonAsync(outputPath, enrichedResult, cancellationToken);
        await fileStore.WriteTextAsync(summaryPath, summaryWriter.Create(enrichedResult), cancellationToken);
        return 0;
    }

    private static string GetRequiredOption(IReadOnlyDictionary<string, string> options, string name)
    {
        return options.TryGetValue(name, out var value) && !string.IsNullOrWhiteSpace(value)
            ? value
            : throw new InvalidOperationException($"Missing required option --{name}.");
    }

    private static string? GetOptionalOption(IReadOnlyDictionary<string, string> options, string name)
    {
        return options.TryGetValue(name, out var value) && !string.IsNullOrWhiteSpace(value)
            ? value
            : null;
    }

    private static string GetDefaultSummaryPath(string resultOutputPath)
    {
        var directory = Path.GetDirectoryName(resultOutputPath) ?? Environment.CurrentDirectory;
        return Path.Combine(directory, "summary.md");
    }
}
