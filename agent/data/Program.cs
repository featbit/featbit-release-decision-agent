using FRD.DataServer.Services;

var builder = WebApplication.CreateBuilder(args);

// -- HTTP client for tsdb (metric queries) --
var tsdbBaseUrl = builder.Configuration["TsdbBaseUrl"] ?? "http://localhost:5059";
builder.Services.AddHttpClient("TsdbClient", client =>
{
    client.BaseAddress = new Uri(tsdbBaseUrl);
});

// -- Experiment worker (collect metrics via tsdb + Bayesian analysis) --
builder.Services.Configure<ExperimentWorkerOptions>(
    builder.Configuration.GetSection("ExperimentWorker"));
builder.Services.AddSingleton<MetricCollector>();
builder.Services.AddSingleton<PythonAnalyzer>();
builder.Services.AddHttpClient();
builder.Services.AddHostedService<ExperimentWorker>();

var app = builder.Build();

app.MapGet("/health", () => Results.Ok(new { status = "healthy" }));

app.Run();
