namespace FRD.DataServer.Services;

/// <summary>
/// Extracts and validates environment ID from the Authorization header.
/// The SDK sends the env secret as a bearer-like token; we parse the envId from it.
///
/// FeatBit env secrets are base64-encoded JSON: {"envId":"...","envSecret":"..."}.
/// For simplicity in v1, we accept the envId directly as the Authorization header value.
/// </summary>
public static class EnvAuth
{
    /// <summary>
    /// Try to extract a non-empty envId from the Authorization header value.
    /// Returns true if a valid envId was found.
    /// </summary>
    public static bool TryGetEnvId(string? authHeader, out string envId)
    {
        envId = string.Empty;

        if (string.IsNullOrWhiteSpace(authHeader))
            return false;

        // Accept raw envId string directly (e.g. "env-abc123")
        // In production, this would decode the FeatBit secret format.
        var trimmed = authHeader.Trim();
        if (trimmed.Length == 0)
            return false;

        envId = trimmed;
        return true;
    }
}
