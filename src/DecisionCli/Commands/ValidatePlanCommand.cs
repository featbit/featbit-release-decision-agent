using Core.Models;
using Core.Services;

namespace DecisionCli.Commands;

public sealed class ValidatePlanCommand : ICommandHandler
{
    private readonly FileStore fileStore;
    private readonly PlanValidator planValidator;

    public ValidatePlanCommand(FileStore fileStore, PlanValidator planValidator)
    {
        this.fileStore = fileStore;
        this.planValidator = planValidator;
    }

    public string Name => "validate-plan";

    public async Task<int> ExecuteAsync(IReadOnlyDictionary<string, string> options, CancellationToken cancellationToken = default)
    {
        var planPath = GetRequiredOption(options, "plan");
        var catalogPath = GetRequiredOption(options, "catalog");

        ExperimentPlan plan = await fileStore.ReadJsonAsync<ExperimentPlan>(planPath, cancellationToken);
        DataCatalog catalog = await fileStore.ReadJsonAsync<DataCatalog>(catalogPath, cancellationToken);

        var errors = planValidator.Validate(plan, catalog);
        if (errors.Count == 0)
        {
            Console.WriteLine("Plan validation succeeded.");
            return 0;
        }

        foreach (var error in errors)
        {
            Console.Error.WriteLine(error);
        }

        return 1;
    }

    private static string GetRequiredOption(IReadOnlyDictionary<string, string> options, string name)
    {
        return options.TryGetValue(name, out var value) && !string.IsNullOrWhiteSpace(value)
            ? value
            : throw new InvalidOperationException($"Missing required option --{name}.");
    }
}
