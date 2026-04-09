using System.Threading.Channels;
using FeatBit.TrackApi.Models;
using Npgsql;

namespace FeatBit.TrackApi.Services;

/// <summary>
/// Background consumer that reads MetricEventMessages from the channel,
/// batches them, and flushes to PostgreSQL metric_events table via COPY.
/// </summary>
public sealed class MetricEventConsumer : BackgroundService
{
    private readonly EventChannel _channel;
    private readonly NpgsqlDataSource _dataSource;
    private readonly ILogger<MetricEventConsumer> _logger;

    private const int BatchSize = 1000;
    private static readonly TimeSpan FlushInterval = TimeSpan.FromSeconds(1);

    public MetricEventConsumer(EventChannel channel, NpgsqlDataSource dataSource, ILogger<MetricEventConsumer> logger)
    {
        _channel = channel;
        _dataSource = dataSource;
        _logger = logger;
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        _logger.LogInformation("MetricEventConsumer started");

        var batch = new List<MetricEventMessage>(BatchSize);
        var reader = _channel.MetricEventReader;

        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                batch.Clear();
                await FillBatchAsync(reader, batch, stoppingToken);

                if (batch.Count > 0)
                {
                    await FlushMetricEventsAsync(batch, stoppingToken);
                }
            }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
            {
                break;
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error in MetricEventConsumer loop, batch had {Count} items", batch.Count);
                await Task.Delay(500, stoppingToken);
            }
        }

        await DrainAsync(reader);
        _logger.LogInformation("MetricEventConsumer stopped");
    }

    private static async Task FillBatchAsync(
        ChannelReader<MetricEventMessage> reader,
        List<MetricEventMessage> batch,
        CancellationToken ct)
    {
        if (!await reader.WaitToReadAsync(ct))
            return;

        using var timer = new CancellationTokenSource(FlushInterval);
        using var linked = CancellationTokenSource.CreateLinkedTokenSource(ct, timer.Token);

        while (batch.Count < BatchSize && reader.TryRead(out var msg))
        {
            batch.Add(msg);
        }

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

    private async Task FlushMetricEventsAsync(List<MetricEventMessage> batch, CancellationToken ct)
    {
        await using var conn = await _dataSource.OpenConnectionAsync(ct);
        await using var writer = await conn.BeginBinaryImportAsync(
            "COPY metric_events (env_id, event_name, user_key, numeric_value, occurred_at, source, props) " +
            "FROM STDIN (FORMAT BINARY)", ct);

        foreach (var msg in batch)
        {
            await writer.StartRowAsync(ct);
            await writer.WriteAsync(msg.EnvId, NpgsqlTypes.NpgsqlDbType.Text, ct);
            await writer.WriteAsync(msg.EventName, NpgsqlTypes.NpgsqlDbType.Text, ct);
            await writer.WriteAsync(msg.UserKey, NpgsqlTypes.NpgsqlDbType.Text, ct);
            if (msg.NumericValue.HasValue)
                await writer.WriteAsync((decimal)msg.NumericValue.Value, NpgsqlTypes.NpgsqlDbType.Numeric, ct);
            else
                await writer.WriteNullAsync(ct);
            await writer.WriteAsync(msg.OccurredAt, NpgsqlTypes.NpgsqlDbType.TimestampTz, ct);
            if (msg.Source is not null)
                await writer.WriteAsync(msg.Source, NpgsqlTypes.NpgsqlDbType.Text, ct);
            else
                await writer.WriteNullAsync(ct);
            if (msg.Props is not null)
                await writer.WriteAsync(msg.Props, NpgsqlTypes.NpgsqlDbType.Jsonb, ct);
            else
                await writer.WriteAsync("{}", NpgsqlTypes.NpgsqlDbType.Jsonb, ct);
        }

        await writer.CompleteAsync(ct);
        _logger.LogDebug("Flushed {Count} metric events to PG", batch.Count);
    }

    private async Task DrainAsync(ChannelReader<MetricEventMessage> reader)
    {
        var remaining = new List<MetricEventMessage>();
        while (reader.TryRead(out var msg))
            remaining.Add(msg);

        if (remaining.Count > 0)
        {
            try
            {
                await FlushMetricEventsAsync(remaining, CancellationToken.None);
                _logger.LogInformation("Drained {Count} metric events on shutdown", remaining.Count);
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Failed to drain {Count} metric events on shutdown", remaining.Count);
            }
        }
    }
}
