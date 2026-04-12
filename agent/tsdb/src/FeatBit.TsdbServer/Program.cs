using FeatBit.DataWarehouse;
using FeatBit.TsdbServer.Endpoints;

var builder = WebApplication.CreateBuilder(args);

var dataRoot = builder.Configuration["DataRoot"] ?? "/data/tsdb";
Directory.CreateDirectory(dataRoot);

var maxBatchSize = builder.Configuration.GetValue("Storage:MaxBatchSize", 10_000);
var flushSeconds = builder.Configuration.GetValue("Storage:FlushIntervalSeconds", 1);

var storageEngine = new StorageEngine(
    dataRoot,
    maxBatchSize: maxBatchSize,
    flushInterval: TimeSpan.FromSeconds(flushSeconds));

builder.Services.AddSingleton(storageEngine);
builder.Services.AddSingleton(storageEngine.CreateQueryEngine());

var app = builder.Build();

app.MapTrackEndpoints();
app.MapQueryEndpoints();

try
{
    await app.RunAsync();
}
finally
{
    await storageEngine.DisposeAsync();
}
