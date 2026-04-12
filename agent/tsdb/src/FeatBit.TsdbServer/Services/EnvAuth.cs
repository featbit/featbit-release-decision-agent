namespace FeatBit.TsdbServer.Services;

/// <summary>
/// Extracts and validates environment ID from the Authorization header.
/// Identical to EnvAuth in agent/data — shared SDK contract.
/// </summary>
public static class EnvAuth
{
    public static bool TryGetEnvId(string? authHeader, out string envId)
    {
        envId = string.Empty;

        if (string.IsNullOrWhiteSpace(authHeader))
            return false;

        var trimmed = authHeader.Trim();
        if (trimmed.Length == 0)
            return false;

        envId = trimmed;
        return true;
    }
}
