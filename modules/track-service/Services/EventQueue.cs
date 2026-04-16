using System.Threading.Channels;
using FeatBit.TrackService.Models;
using Microsoft.Extensions.Options;

namespace FeatBit.TrackService.Services;

/// <summary>
/// Singleton wrapper around a bounded <see cref="Channel{T}"/> of EventRecord.
/// This is the "in-memory Kafka" — producers (HTTP handlers) write into it
/// without blocking on ClickHouse, and a single BackgroundService drains it
/// in batches.
///
/// Bounded + DropNewest: if ClickHouse is unhealthy and the queue fills, we
/// drop the newest events rather than letting the API fall over. (Adjust to
/// FullMode.Wait if you'd rather apply back-pressure on producers.)
/// </summary>
public sealed class EventQueue
{
    public Channel<EventRecord> Channel { get; }

    public EventQueue(IOptions<IngestOptions> opts)
    {
        Channel = System.Threading.Channels.Channel.CreateBounded<EventRecord>(
            new BoundedChannelOptions(opts.Value.ChannelCapacity)
            {
                FullMode     = BoundedChannelFullMode.DropNewest,
                SingleReader = true,
                SingleWriter = false,
            });
    }

    /// <summary>Non-blocking enqueue. Returns false if the channel was full and the event was dropped.</summary>
    public bool TryWrite(EventRecord rec) => Channel.Writer.TryWrite(rec);
}
