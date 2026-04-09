using System.Threading.Channels;
using FRD.DataServer.Models;
using Npgsql;

namespace FRD.DataServer.Services;

/// <summary>
/// Background consumer that reads FlagEvalMessages from the channel,
/// batches them, and flushes to PostgreSQL flag_evaluations table via COPY.
/// </summary>
public sealed class FlagEvalConsumer : BackgroundService
{
    private readonly EventChannel _channel;
    private readonly NpgsqlDataSource _dataSource;
    private readonly ILogger<FlagEvalConsumer> _logger;

    private const int BatchSize = 1000;
    private static readonly TimeSpan FlushInterval = TimeSpan.FromSeconds(1);

    public FlagEvalConsumer(EventChannel channel, NpgsqlDataSource dataSource, ILogger<FlagEvalConsumer> logger)
    {
        _channel = channel;
        _dataSource = dataSource;
        _logger = logger;
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        _logger.LogInformation("FlagEvalConsumer started");

        var batch = new List<FlagEvalMessage>(BatchSize);
        var reader = _channel.FlagEvalReader;

        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                batch.Clear();
                await FillBatchAsync(reader, batch, stoppingToken);

                if (batch.Count > 0)
                {
                    await FlushFlagEvalsAsync(batch, stoppingToken);
                }
            }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
            {
                break;
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error in FlagEvalConsumer loop, batch had {Count} items", batch.Count);
                // brief pause to avoid tight error loops
                await Task.Delay(500, stoppingToken);
            }
        }

        // Drain remaining items on shutdown
        await DrainAsync(reader);
        _logger.LogInformation("FlagEvalConsumer stopped");
    }

    private static async Task FillBatchAsync(
        ChannelReader<FlagEvalMessage> reader,
        List<FlagEvalMessage> batch,
        CancellationToken ct)
    {
        // Wait for at least one item
        if (!await reader.WaitToReadAsync(ct))
            return;

        using var timer = new CancellationTokenSource(FlushInterval);
        using var linked = CancellationTokenSource.CreateLinkedTokenSource(ct, timer.Token);

        while (batch.Count < BatchSize && reader.TryRead(out var msg))
        {
            batch.Add(msg);
        }

        // If batch isn't full, wait for more until timer fires
        if (batch.Count < BatchSize)
        {
            try
            {
                while (batch.Count < BatchSize && await reader.WaitToReadAsync(linked.Token))
                {
                    while (batch.Count < BatchSize && reader.TryRead(out var msg))
                    {
                        batch.Add(msg);
                    }
                }
            }
            catch (OperationCanceledException)
            {
                // timer fired — flush what we have
            }
        }
    }

    private async Task FlushFlagEvalsAsync(List<FlagEvalMessage> batch, CancellationToken ct)
    {
        await using var conn = await _dataSource.OpenConnectionAsync(ct);
        await using var writer = await conn.BeginBinaryImportAsync(
            "COPY flag_evaluations (env_id, flag_key, user_key, variant, experiment_id, layer_id, evaluated_at) " +
            "FROM STDIN (FORMAT BINARY)", ct);

        foreach (var msg in batch)
        {
            await writer.StartRowAsync(ct);
            await writer.WriteAsync(msg.EnvId, NpgsqlTypes.NpgsqlDbType.Text, ct);
            await writer.WriteAsync(msg.FlagKey, NpgsqlTypes.NpgsqlDbType.Text, ct);
            await writer.WriteAsync(msg.UserKey, NpgsqlTypes.NpgsqlDbType.Text, ct);
            await writer.WriteAsync(msg.Variant, NpgsqlTypes.NpgsqlDbType.Text, ct);
            if (msg.ExperimentId is not null)
                await writer.WriteAsync(msg.ExperimentId, NpgsqlTypes.NpgsqlDbType.Text, ct);
            else
                await writer.WriteNullAsync(ct);
            if (msg.LayerId is not null)
                await writer.WriteAsync(msg.LayerId, NpgsqlTypes.NpgsqlDbType.Text, ct);
            else
                await writer.WriteNullAsync(ct);
            await writer.WriteAsync(msg.EvaluatedAt, NpgsqlTypes.NpgsqlDbType.TimestampTz, ct);
        }

        await writer.CompleteAsync(ct);
        _logger.LogDebug("Flushed {Count} flag evaluations to PG", batch.Count);
    }

    private async Task DrainAsync(ChannelReader<FlagEvalMessage> reader)
    {
        var remaining = new List<FlagEvalMessage>();
        while (reader.TryRead(out var msg))
            remaining.Add(msg);

        if (remaining.Count > 0)
        {
            try
            {
                await FlushFlagEvalsAsync(remaining, CancellationToken.None);
                _logger.LogInformation("Drained {Count} flag evaluations on shutdown", remaining.Count);
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Failed to drain {Count} flag evaluations on shutdown", remaining.Count);
            }
        }
    }
}
