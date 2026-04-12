using System.Text.RegularExpressions;

namespace FeatBit.DataWarehouse.Storage;

/// <summary>
/// Filesystem path utilities shared by <see cref="StorageEngine"/>,
/// <see cref="FlagEvalScanner"/>, and <see cref="MetricEventScanner"/>.
/// </summary>
internal static partial class PathHelper
{
    /// <summary>
    /// Replace any character that is not alphanumeric, hyphen, or underscore with '_'.
    /// Keeps partition directory names safe across Linux, macOS, and Windows.
    /// </summary>
    public static string Sanitize(string input) => InvalidChars().Replace(input, "_");

    [GeneratedRegex(@"[^\w\-]", RegexOptions.CultureInvariant)]
    private static partial Regex InvalidChars();

    // ── Partition path builders ───────────────────────────────────────────────

    public static string FlagEvalPartitionDir(string dataRoot, string envId, string flagKey, string date)
        => Path.Combine(dataRoot, "flag-evals", Sanitize(envId), Sanitize(flagKey), date);

    public static string MetricEventPartitionDir(string dataRoot, string envId, string eventName, string date)
        => Path.Combine(dataRoot, "metric-events", Sanitize(envId), Sanitize(eventName), date);

    /// <summary>
    /// Return all date-partition directories for a flag-eval partition
    /// whose date falls within [startDate, endDate] (inclusive, UTC).
    /// </summary>
    public static IEnumerable<string> FlagEvalDateDirs(
        string dataRoot, string envId, string flagKey,
        DateOnly startDate, DateOnly endDate)
        => DateDirs(
            Path.Combine(dataRoot, "flag-evals", Sanitize(envId), Sanitize(flagKey)),
            startDate, endDate);

    /// <summary>
    /// Return all date-partition directories for a metric-event partition
    /// whose date falls within [startDate, endDate] (inclusive, UTC).
    /// </summary>
    public static IEnumerable<string> MetricEventDateDirs(
        string dataRoot, string envId, string eventName,
        DateOnly startDate, DateOnly endDate)
        => DateDirs(
            Path.Combine(dataRoot, "metric-events", Sanitize(envId), Sanitize(eventName)),
            startDate, endDate);

    private static IEnumerable<string> DateDirs(string root, DateOnly startDate, DateOnly endDate)
    {
        if (!Directory.Exists(root)) yield break;

        foreach (var dir in Directory.EnumerateDirectories(root).Order())
        {
            var name = Path.GetFileName(dir);
            if (DateOnly.TryParseExact(name, "yyyy-MM-dd", out var date)
                && date >= startDate && date <= endDate)
            {
                yield return dir;
            }
        }
    }
}
