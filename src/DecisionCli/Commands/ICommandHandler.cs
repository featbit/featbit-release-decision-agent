namespace DecisionCli.Commands;

public interface ICommandHandler
{
    string Name { get; }

    Task<int> ExecuteAsync(IReadOnlyDictionary<string, string> options, CancellationToken cancellationToken = default);
}
