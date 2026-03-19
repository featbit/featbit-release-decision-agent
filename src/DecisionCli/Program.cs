using Core.Services;
using Data.Postgres;
using DecisionCli.Commands;

var fileStore = new FileStore();
var postgresConnectionFactory = new PostgresConnectionFactory();
var metricTemplateRegistry = new MetricTemplateRegistry();
var sqlTemplateLoader = new SqlTemplateLoader(metricTemplateRegistry);
var recipeCatalog = new RecipeCatalog();

IReadOnlyDictionary<string, IDataSourceAdapter> adapters = new Dictionary<string, IDataSourceAdapter>(StringComparer.OrdinalIgnoreCase)
{
	["postgres"] = new PostgresDataSourceAdapter(postgresConnectionFactory, sqlTemplateLoader)
};

var planValidator = new PlanValidator(recipeCatalog, metricTemplateRegistry);
var recommendationEngine = new RecommendationEngine();

var commands = new Dictionary<string, ICommandHandler>(StringComparer.OrdinalIgnoreCase)
{
	["inspect"] = new InspectCommand(adapters, fileStore),
	["validate-plan"] = new ValidatePlanCommand(fileStore, planValidator),
	["run"] = new RunCommand(fileStore, adapters, recommendationEngine),
	["sync-dry-run"] = new SyncDryRunCommand(fileStore)
};

if (args.Length == 0 || args[0] is "-h" or "--help")
{
	PrintUsage(commands.Keys);
	return 0;
}

var commandName = args[0];
if (!commands.TryGetValue(commandName, out var command))
{
	Console.Error.WriteLine($"Unknown command '{commandName}'.");
	PrintUsage(commands.Keys);
	return 1;
}

try
{
	var options = ParseOptions(args.Skip(1).ToArray());
	return await command.ExecuteAsync(options);
}
catch (Exception exception)
{
	Console.Error.WriteLine(exception.Message);
	return 1;
}

static Dictionary<string, string> ParseOptions(string[] args)
{
	var options = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);

	for (var index = 0; index < args.Length; index++)
	{
		var token = args[index];
		if (!token.StartsWith("--", StringComparison.Ordinal))
		{
			throw new InvalidOperationException($"Unexpected token '{token}'. Expected an option starting with '--'.");
		}

		if (index + 1 >= args.Length)
		{
			throw new InvalidOperationException($"Option '{token}' is missing a value.");
		}

		var key = token[2..];
		var value = args[++index];
		options[key] = value;
	}

	return options;
}

static void PrintUsage(IEnumerable<string> commandNames)
{
	Console.WriteLine("Usage: featbit-decision <command> [options]");
	Console.WriteLine();
	Console.WriteLine("Connection options:");
	Console.WriteLine("  --connection-env <ENV_VAR_NAME>   Preferred. Read the database connection from an environment variable.");
	Console.WriteLine("  --connection <RAW_CONNECTION>     Development-only fallback.");
	Console.WriteLine();
	Console.WriteLine("Commands:");

	foreach (var commandName in commandNames)
	{
		Console.WriteLine($"  {commandName}");
	}
}
