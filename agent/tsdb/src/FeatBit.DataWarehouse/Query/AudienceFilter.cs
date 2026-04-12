namespace FeatBit.DataWarehouse.Query;

/// <summary>
/// One audience filter rule applied to user_props at flag evaluation time.
/// Mirrors <c>AudienceFilterEntry</c> in the DataServer project.
///
/// Supported ops: eq | neq | in | nin
/// </summary>
public sealed class AudienceFilter
{
    public required string Property { get; init; }

    /// <summary>eq | neq | in | nin</summary>
    public required string Op { get; init; }

    /// <summary>Scalar value for eq / neq.</summary>
    public string? Value { get; init; }

    /// <summary>Value list for in / nin.</summary>
    public IReadOnlyList<string>? Values { get; init; }

    /// <summary>
    /// Returns true if <paramref name="props"/> satisfies this filter.
    /// A null or missing property is treated as "not present":
    ///   • neq / nin → passes (absent ≠ any value)
    ///   • eq  / in  → fails
    /// </summary>
    public bool Matches(IReadOnlyDictionary<string, string>? props)
    {
        if (props is null || !props.TryGetValue(Property, out var actual))
            return Op is "neq" or "nin";

        return Op switch
        {
            "eq"  => actual == Value,
            "neq" => actual != Value,
            "in"  => Values?.Contains(actual, StringComparer.Ordinal) == true,
            "nin" => Values?.Contains(actual, StringComparer.Ordinal) != true,
            _     => true,
        };
    }
}
