using FRD.DataServer.Endpoints;
using FRD.DataServer.Services;

var builder = WebApplication.CreateBuilder(args);

// -- HTTP client for tsdb (metric queries) --
// TsdbProvider: "cloudflare" → tsdb.featbit.ai, "local" → localhost:5059 / docker tsdb
var tsdbProvider = builder.Configuration["TsdbProvider"] ?? "cloudflare";
var tsdbBaseUrl = builder.Configuration[$"TsdbBaseUrl:{tsdbProvider}"]
    ?? builder.Configuration["TsdbBaseUrl"]
    ?? (tsdbProvider == "cloudflare" ? "https://tsdb.featbit.ai" : "http://localhost:5059");
builder.Services.AddHttpClient("TsdbClient", client =>
{
    client.BaseAddress = new Uri(tsdbBaseUrl);
});
builder.Services.AddSingleton(new TsdbConfig(tsdbProvider, tsdbBaseUrl));

// -- Experiment worker (collect metrics via tsdb + Bayesian analysis) --
builder.Services.Configure<ExperimentWorkerOptions>(
    builder.Configuration.GetSection("ExperimentWorker"));
builder.Services.AddSingleton<MetricCollector>();
builder.Services.AddSingleton<PythonAnalyzer>();
builder.Services.AddHttpClient();
// ExperimentWorker disabled — analysis is now triggered on-demand via POST /analyze
// builder.Services.AddHostedService<ExperimentWorker>();

var app = builder.Build();

app.Logger.LogInformation("TSDB provider: {Provider} → {Url}", tsdbProvider, tsdbBaseUrl);

app.MapGet("/health", () => Results.Ok(new { status = "healthy" }));
app.MapAnalyzeEndpoints();

app.Run();

// ── Minimal config record ────────────────────────────────────────────────────
public record TsdbConfig(string Provider, string BaseUrl);
