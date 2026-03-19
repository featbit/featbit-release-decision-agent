using Core.Models;
using Core.Services;

namespace DecisionCli.Commands;

public sealed class InspectCommand : ICommandHandler
{
    private readonly IReadOnlyDictionary<string, IDataSourceAdapter> adapters;
    private readonly FileStore fileStore;

    public InspectCommand(IReadOnlyDictionary<string, IDataSourceAdapter> adapters, FileStore fileStore)
    {
        this.adapters = adapters;
        this.fileStore = fileStore;
    }

    public string Name => "inspect";

    public async Task<int> ExecuteAsync(IReadOnlyDictionary<string, string> options, CancellationToken cancellationToken = default)
    {
        var dataSourceKind = GetRequiredOption(options, "data-source-kind", "warehouse");
        var connection = ConnectionResolver.Resolve(options);
        var outputPath = GetRequiredOption(options, "out");

        if (!adapters.TryGetValue(dataSourceKind, out var adapter))
        {
            throw new InvalidOperationException($"Unsupported data source kind '{dataSourceKind}'.");
        }

        DataCatalog catalog = await adapter.InspectAsync(connection, cancellationToken);
        await fileStore.WriteJsonAsync(outputPath, catalog, cancellationToken);
        return 0;
    }

    private static string GetRequiredOption(IReadOnlyDictionary<string, string> options, params string[] names)
    {
        foreach (var name in names)
        {
            if (options.TryGetValue(name, out var value) && !string.IsNullOrWhiteSpace(value))
            {
                return value;
            }
        }

        throw new InvalidOperationException($"Missing required option. Expected one of: {string.Join(", ", names.Select(name => $"--{name}"))}.");
    }
}
