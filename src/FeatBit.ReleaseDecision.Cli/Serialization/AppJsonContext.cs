using System.Text.Json.Serialization;
using FeatBit.ReleaseDecision.Cli.Models;

namespace FeatBit.ReleaseDecision.Cli.Serialization;

[JsonSerializable(typeof(PlanJson))]
[JsonSerializable(typeof(CatalogJson))]
[JsonSerializable(typeof(ResultsJson))]
[JsonSerializable(typeof(FeatBitActionsJson))]
[JsonSerializable(typeof(Dictionary<string, string>))]
[JsonSourceGenerationOptions(WriteIndented = true)]
public partial class AppJsonContext : JsonSerializerContext
{
}
