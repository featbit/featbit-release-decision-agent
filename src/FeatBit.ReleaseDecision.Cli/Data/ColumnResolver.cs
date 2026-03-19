namespace FeatBit.ReleaseDecision.Cli.Data;

/// <summary>
/// Resolves canonical recipe field names to actual table column names.
/// Resolution order: explicit column_mappings in plan → column exists by canonical name → not found.
/// </summary>
public static class ColumnResolver
{
    // Canonical field names understood by the engine
    public static readonly string[] KnownCanonicals =
        ["task_id", "variant", "success", "cost", "latency_ms", "timestamp"];

    public static bool TryResolve(
        string canonical,
        Dictionary<string, string>? columnMappings,
        string[] availableColumns,
        out string resolved)
    {
        // 1. Explicit mapping in plan.json wins
        if (columnMappings != null && columnMappings.TryGetValue(canonical, out var mapped))
        {
            resolved = mapped;
            return true;
        }

        // 2. Column with the exact canonical name exists in the table
        var match = availableColumns.FirstOrDefault(
            c => c.Equals(canonical, StringComparison.OrdinalIgnoreCase));
        if (match != null)
        {
            resolved = match;
            return true;
        }

        resolved = "";
        return false;
    }
}
