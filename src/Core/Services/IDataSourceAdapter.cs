using Core.Models;

namespace Core.Services;

public interface IDataSourceAdapter
{
    string Kind { get; }

    Task<DataCatalog> InspectAsync(string connectionString, CancellationToken cancellationToken = default);

    Task<EvaluationResult> RunAsync(string connectionString, ExperimentPlan plan, CancellationToken cancellationToken = default);
}