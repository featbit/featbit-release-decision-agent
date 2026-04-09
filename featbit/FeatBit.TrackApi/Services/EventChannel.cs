using System.Threading.Channels;
using FeatBit.TrackApi.Models;

namespace FeatBit.TrackApi.Services;

/// <summary>
/// In-memory message bus backed by System.Threading.Channels.
/// Provides bounded, backpressure-aware producer→consumer pipelines
/// without any external dependency (replaces Redis / Kafka).
/// </summary>
public sealed class EventChannel
{
    private readonly Channel<FlagEvalMessage> _flagEvals;
    private readonly Channel<MetricEventMessage> _metricEvents;

    public EventChannel(int capacity = 10_000)
    {
        var options = new BoundedChannelOptions(capacity)
        {
            FullMode = BoundedChannelFullMode.Wait, // backpressure: slow down producers
            SingleReader = true,
            SingleWriter = false
        };

        _flagEvals = Channel.CreateBounded<FlagEvalMessage>(options);
        _metricEvents = Channel.CreateBounded<MetricEventMessage>(options);
    }

    public ChannelWriter<FlagEvalMessage> FlagEvalWriter => _flagEvals.Writer;
    public ChannelReader<FlagEvalMessage> FlagEvalReader => _flagEvals.Reader;

    public ChannelWriter<MetricEventMessage> MetricEventWriter => _metricEvents.Writer;
    public ChannelReader<MetricEventMessage> MetricEventReader => _metricEvents.Reader;
}
