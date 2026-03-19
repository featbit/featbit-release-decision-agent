using FeatBit.ReleaseDecision.Cli.Commands;

var stdout = Console.Out;
var stderr = Console.Error;

if (args.Length == 0 || args[0] is "-h" or "--help" or "help")
{
    PrintHelp(stdout);
    return 0;
}

if (!string.Equals(args[0], "decision", StringComparison.OrdinalIgnoreCase))
{
    await stderr.WriteLineAsync($"error: unknown command '{args[0]}'");
    await stderr.WriteLineAsync("usage: featbit-decision decision <subcommand> [options]");
    await stderr.WriteLineAsync("run 'featbit-decision --help' for usage");
    return 1;
}

if (args.Length < 2 || args[1] is "-h" or "--help")
{
    PrintHelp(stdout);
    return 0;
}

var subcommand = args[1].ToLowerInvariant();
var opts = ParseOptions(args[2..]);

return subcommand switch
{
    "inspect" => await InspectCommand.RunAsync(
        opts.GetValueOrDefault("--connection-env"),
        opts.GetValueOrDefault("--out"),
        stdout, stderr),

    "validate-plan" => await ValidatePlanCommand.RunAsync(
        opts.GetValueOrDefault("--plan"),
        opts.GetValueOrDefault("--catalog"),
        stdout, stderr),

    "run" => await RunCommand.RunAsync(
        opts.GetValueOrDefault("--plan"),
        opts.GetValueOrDefault("--catalog"),
        opts.GetValueOrDefault("--connection-env"),
        opts.GetValueOrDefault("--out"),
        opts.GetValueOrDefault("--summary-out"),
        stdout, stderr),

    "sync-dry-run" => await SyncDryRunCommand.RunAsync(
        opts.GetValueOrDefault("--plan"),
        opts.GetValueOrDefault("--out"),
        stdout, stderr),

    _ => await UnknownSubcommandAsync(stderr, subcommand)
};

static Dictionary<string, string> ParseOptions(string[] args)
{
    var result = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
    for (int i = 0; i < args.Length; i++)
    {
        if (args[i].StartsWith("--") && i + 1 < args.Length && !args[i + 1].StartsWith("--"))
        {
            result[args[i]] = args[i + 1];
            i++;
        }
    }
    return result;
}

static void PrintHelp(TextWriter w)
{
    w.WriteLine("featbit-decision — FeatBit Release Decision CLI (.NET 10 AOT)");
    w.WriteLine();
    w.WriteLine("Usage:");
    w.WriteLine("  featbit-decision decision inspect");
    w.WriteLine("      --connection-env <VAR> --out <catalog.json>");
    w.WriteLine();
    w.WriteLine("  featbit-decision decision validate-plan");
    w.WriteLine("      --plan <plan.json> [--catalog <catalog.json>]");
    w.WriteLine();
    w.WriteLine("  featbit-decision decision run");
    w.WriteLine("      --plan <plan.json> --catalog <catalog.json>");
    w.WriteLine("      --connection-env <VAR> --out <results.json> --summary-out <summary.md>");
    w.WriteLine();
    w.WriteLine("  featbit-decision decision sync-dry-run");
    w.WriteLine("      --plan <plan.json> --out <featbit-actions.json>");
    w.WriteLine();
    w.WriteLine("Options:");
    w.WriteLine("  --connection-env <VAR>   Name of the environment variable holding the");
    w.WriteLine("                           PostgreSQL connection string (never pass the");
    w.WriteLine("                           connection string directly on the command line)");
    w.WriteLine("  --plan <path>            Path to plan.json");
    w.WriteLine("  --catalog <path>         Path to catalog.json (from 'inspect')");
    w.WriteLine("  --out <path>             Path to write the primary output file");
    w.WriteLine("  --summary-out <path>     Path to write the markdown summary (run only)");
}

static async Task<int> UnknownSubcommandAsync(TextWriter stderr, string sub)
{
    await stderr.WriteLineAsync($"error: unknown subcommand '{sub}'");
    await stderr.WriteLineAsync("supported subcommands: inspect, validate-plan, run, sync-dry-run");
    return 1;
}
