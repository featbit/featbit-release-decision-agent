using System.Net.Http.Json;
using System.Security.Cryptography;
using System.Text;

// ── Configuration via environment variables ──────────────────────────────────

var trackApiUrl = Env("TRACK_API_URL", "http://localhost:5058/api/track");
var envSecret   = Env("ENV_SECRET",    "sim-env-001");
var flagKey     = Env("FLAG_KEY",      "onboarding-checklist");
var expId       = Env("EXPERIMENT_ID", "");  // empty = no experiment_id filter
var ctrlVariant = Env("CONTROL_VARIANT",   "control");
var trtVariant  = Env("TREATMENT_VARIANT", "checklist");
var metricEvent = Env("METRIC_EVENT",  "onboarding_completed");

var batchSize       = int.Parse(Env("BATCH_SIZE",       "5"));
var batchDelayMs    = int.Parse(Env("BATCH_DELAY_MS",   "3000"));
var ctrlConvRate    = double.Parse(Env("CONTROL_CONV_RATE",   "0.32"));
var trtConvRate     = double.Parse(Env("TREATMENT_CONV_RATE", "0.45"));
var startupDelaySec = int.Parse(Env("STARTUP_DELAY_SEC", "5"));

// ── Startup delay (wait for dependent services) ──────────────────────────────

Console.WriteLine($"[simulator] waiting {startupDelaySec}s for services to start...");
await Task.Delay(TimeSpan.FromSeconds(startupDelaySec));

// ── Setup ────────────────────────────────────────────────────────────────────

var rng = new Random();

Console.WriteLine($"[simulator] target: {trackApiUrl}");
Console.WriteLine($"[simulator] batch size: {batchSize} users every {batchDelayMs}ms (continuous mode)");

// ── Continuous simulation loop ───────────────────────────────────────────────

using var http = new HttpClient();
http.DefaultRequestHeaders.Add("Authorization", envSecret);

var totalFlagEvals = 0;
var totalMetrics   = 0;
var batchNum       = 0;
var userCounter    = 0;

// Use a cancellation token so Ctrl+C / SIGTERM exits cleanly
using var cts = new CancellationTokenSource();
Console.CancelKeyPress += (_, e) =>
{
    e.Cancel = true;
    cts.Cancel();
};

Console.WriteLine($"[simulator] running — press Ctrl+C to stop");

while (!cts.Token.IsCancellationRequested)
{
    batchNum++;
    var batch = new List<TrackPayload>();

    for (var i = 0; i < batchSize; i++)
    {
        userCounter++;
        var userId = $"user-{userCounter:D7}";

        // Stable 50/50 variant assignment via hash
        var hash    = Math.Abs(StableHash(userId + flagKey)) % 100;
        var variant = hash < 50 ? ctrlVariant : trtVariant;
        var convRate = variant == ctrlVariant ? ctrlConvRate : trtConvRate;

        // Eval timestamp: a random moment in the last 2 minutes (feels like live traffic)
        var evalTime = DateTimeOffset.UtcNow.AddSeconds(-rng.Next(0, 120));
        var evalTs   = evalTime.ToUnixTimeSeconds();

        var payload = new TrackPayload
        {
            User = new EndUserDto
            {
                KeyId = userId,
                Name = $"User {userId}",
                Properties = new Dictionary<string, string>
                {
                    ["plan"]   = rng.NextDouble() < 0.3 ? "premium" : "free",
                    ["region"] = PickRandom(rng, ["US", "EU", "APAC"]),
                    ["device"] = rng.NextDouble() < 0.6 ? "desktop" : "mobile",
                }
            },
            Variations =
            [
                new FlagEvalDto
                {
                    FlagKey      = flagKey,
                    Variant      = variant,
                    ExperimentId = string.IsNullOrEmpty(expId) ? null : expId,
                    Timestamp    = evalTs,
                }
            ],
            Metrics = [],
        };

        totalFlagEvals++;

        // Decide if user converts (1–15 min after exposure, so it's already "in the past")
        if (rng.NextDouble() < convRate)
        {
            var convDelay = TimeSpan.FromMinutes(rng.Next(1, 15));
            var convTime  = evalTime.Add(convDelay);
            if (convTime <= DateTimeOffset.UtcNow)
            {
                payload.Metrics =
                [
                    new MetricEventDto
                    {
                        EventName = metricEvent,
                        Timestamp = convTime.ToUnixTimeSeconds(),
                        AppType   = "Web",
                    }
                ];
                totalMetrics++;
            }
        }

        batch.Add(payload);
    }

    try
    {
        var resp = await http.PostAsJsonAsync(trackApiUrl, batch, cts.Token);
        if (!resp.IsSuccessStatusCode)
        {
            var body = await resp.Content.ReadAsStringAsync(cts.Token);
            Console.Error.WriteLine($"[simulator] batch {batchNum} failed: {resp.StatusCode} — {body}");
        }
        else
        {
            Console.WriteLine($"[simulator] batch {batchNum}: +{batch.Count} users " +
                $"| total evals={totalFlagEvals}  conversions={totalMetrics}");
        }
    }
    catch (OperationCanceledException)
    {
        break;
    }
    catch (HttpRequestException ex)
    {
        Console.Error.WriteLine($"[simulator] batch {batchNum} error: {ex.Message} — retrying in 5s");
        await Task.Delay(5000, cts.Token).ContinueWith(_ => { }); // swallow cancel
    }

    try { await Task.Delay(batchDelayMs, cts.Token); }
    catch (OperationCanceledException) { break; }
}

Console.WriteLine();
Console.WriteLine($"[simulator] stopped — sent {totalFlagEvals} evals, {totalMetrics} conversions total");

// ── Helpers ──────────────────────────────────────────────────────────────────

static string Env(string name, string defaultValue) =>
    Environment.GetEnvironmentVariable(name) ?? defaultValue;

static int StableHash(string input)
{
    var bytes = Encoding.UTF8.GetBytes(input);
    var hash = SHA256.HashData(bytes);
    return BitConverter.ToInt32(hash, 0);
}

static T PickRandom<T>(Random rng, T[] items) => items[rng.Next(items.Length)];

class TrackPayload
{
    public EndUserDto User { get; set; } = default!;
    public IReadOnlyList<FlagEvalDto> Variations { get; set; } = [];
    public IReadOnlyList<MetricEventDto> Metrics { get; set; } = [];
}

class EndUserDto
{
    public string KeyId { get; set; } = "";
    public string? Name { get; set; }
    public Dictionary<string, string>? Properties { get; set; }
}

class FlagEvalDto
{
    public string FlagKey { get; set; } = "";
    public string Variant { get; set; } = "";
    public string? ExperimentId { get; set; }
    public long Timestamp { get; set; }
}

class MetricEventDto
{
    public string EventName { get; set; } = "";
    public double? NumericValue { get; set; }
    public string? AppType { get; set; }
    public long Timestamp { get; set; }
}
