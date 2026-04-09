using FeatBit.TrackApi.Endpoints;
using FeatBit.TrackApi.Services;
using Npgsql;

var builder = WebApplication.CreateBuilder(args);

// -- PostgreSQL data source (for COPY writes) --
var pgConnectionString = builder.Configuration.GetConnectionString("EventStore")
    ?? "Host=localhost;Port=5432;Database=featbit_events;Username=postgres;Password=postgres";
var dataSource = NpgsqlDataSource.Create(pgConnectionString);
builder.Services.AddSingleton(dataSource);

// -- In-memory channel bus (replaces Redis/Kafka) --
builder.Services.AddSingleton<EventChannel>();

// -- Background consumers (read channels → batch flush to PG) --
builder.Services.AddHostedService<FlagEvalConsumer>();
builder.Services.AddHostedService<MetricEventConsumer>();

var app = builder.Build();

// -- Endpoints --
app.MapTrackEndpoints();

app.Run();
