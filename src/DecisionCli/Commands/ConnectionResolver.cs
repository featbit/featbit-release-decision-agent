namespace DecisionCli.Commands;

internal static class ConnectionResolver
{
    public static string Resolve(IReadOnlyDictionary<string, string> options)
    {
        if (options.TryGetValue("connection-env", out var envVarName) && !string.IsNullOrWhiteSpace(envVarName))
        {
            var envValue = Environment.GetEnvironmentVariable(envVarName);
            if (string.IsNullOrWhiteSpace(envValue))
            {
                throw new InvalidOperationException($"Environment variable '{envVarName}' was not found or is empty.");
            }

            return envValue;
        }

        if (options.TryGetValue("connection", out var connection) && !string.IsNullOrWhiteSpace(connection))
        {
            return connection;
        }

        throw new InvalidOperationException("Missing database connection input. Use --connection-env for normal usage or --connection only for local development.");
    }
}
