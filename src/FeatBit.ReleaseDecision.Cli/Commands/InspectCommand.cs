using System.Text.Json;
using FeatBit.ReleaseDecision.Cli.Data;
using FeatBit.ReleaseDecision.Cli.Serialization;

namespace FeatBit.ReleaseDecision.Cli.Commands;

public static class InspectCommand
{
    public static async Task<int> RunAsync(
        string? connectionEnv,
        string? outPath,
        TextWriter stdout,
        TextWriter stderr)
    {
        if (string.IsNullOrWhiteSpace(connectionEnv))
        {
            await stderr.WriteLineAsync("error: --connection-env is required");
            return 1;
        }
        if (string.IsNullOrWhiteSpace(outPath))
        {
            await stderr.WriteLineAsync("error: --out is required");
            return 1;
        }

        var connectionString = Environment.GetEnvironmentVariable(connectionEnv);
        if (string.IsNullOrWhiteSpace(connectionString))
        {
            await stderr.WriteLineAsync(
                $"error: environment variable '{connectionEnv}' is not set or is empty");
            return 1;
        }

        try
        {
            var inspector = new PostgresInspector(connectionString);
            var catalog = await inspector.InspectAsync();

            var json = JsonSerializer.Serialize(catalog, AppJsonContext.Default.CatalogJson);
            await File.WriteAllTextAsync(outPath, json);

            await stdout.WriteLineAsync($"catalog written to:    {outPath}");
            await stdout.WriteLineAsync($"tables found:          {catalog.Tables.Length}");
            if (catalog.MetricCandidates.Length > 0)
                await stdout.WriteLineAsync($"metric candidates:     {string.Join(", ", catalog.MetricCandidates)}");
            else
                await stdout.WriteLineAsync("metric candidates:     (none — no table matched ≥2 canonical columns)");

            return 0;
        }
        catch (Exception ex)
        {
            await stderr.WriteLineAsync($"error: {ex.Message}");
            return 1;
        }
    }
}
