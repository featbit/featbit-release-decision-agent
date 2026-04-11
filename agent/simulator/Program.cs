using System.Net.Http.Json;
using System.Security.Cryptography;
using System.Text;

// ══════════════════════════════════════════════════════════════════════════════
// FRD Simulator — single-scenario and multi-scenario modes
//
// SINGLE-SCENARIO MODE  (default, backward-compatible)
//   Reads: TRACK_API_URL, ENV_SECRET, FLAG_KEY, EXPERIMENT_ID,
//          CONTROL_VARIANT, TREATMENT_VARIANT, METRIC_EVENT,
//          CONTROL_CONV_RATE, TREATMENT_CONV_RATE,
//          BATCH_SIZE, BATCH_DELAY_MS, STARTUP_DELAY_SEC
//
// MULTI-SCENARIO MODE  (activated when SCENARIO_COUNT > 0)
//   Shares: TRACK_API_URL, ENV_SECRET, BATCH_SIZE, BATCH_DELAY_MS, STARTUP_DELAY_SEC
//   Per-scenario env vars (N = 1-based scenario index):
//     SCENARIO_N_FLAG_KEY            required
//     SCENARIO_N_METRIC_EVENT        required
//     SCENARIO_N_VARIANTS            required  comma-sep, e.g. "ctrl,trt"
//     SCENARIO_N_CONV_RATES          required  comma-sep doubles, one per variant
//     SCENARIO_N_VARIANT_WEIGHTS     optional  comma-sep ints (0–100), default equal
//     SCENARIO_N_LAYER_ID            optional  layer key for hash-bucket routing
//     SCENARIO_N_LAYER_OFFSET        optional  0–99  (default 0)
//     SCENARIO_N_LAYER_PERCENT       optional  1–100 (default 100)
//     SCENARIO_N_GUARDRAIL_EVENTS    optional  "event:rate_v0:rate_v1,...",... — one
//                                              colon-delimited triple per guard event
//
// Layering & mutual exclusion
//   When a scenario has LAYER_ID, a user only participates if
//   hash(userId + "~layer~" + layerId) % 100 falls in [OFFSET, OFFSET + PERCENT).
//   Two scenarios that share a LAYER_ID with non-overlapping offsets are
//   mutually exclusive — a user enters at most one of them.
//
// Guardrail events
//   Format per event: "event_name:rate_v0:rate_v1[:rate_v2...]"
//   Multiple events separated by commas:
//     "email_bounce:0.09:0.07,form_error:0.14:0.11"
//   Each guardrail fires independently for each user per session.
// ══════════════════════════════════════════════════════════════════════════════

// ── Shared configuration ──────────────────────────────────────────────────────

var trackApiUrl     = Env("TRACK_API_URL", "http://localhost:5058/api/track");
var envSecret       = Env("ENV_SECRET",    "sim-env-001");
var batchSize       = int.Parse(Env("BATCH_SIZE",       "5"));
var batchDelayMs    = int.Parse(Env("BATCH_DELAY_MS",   "3000"));
var startupDelaySec = int.Parse(Env("STARTUP_DELAY_SEC", "5"));

var scenarioCount = int.Parse(Env("SCENARIO_COUNT", "0"));

// ── Startup delay ─────────────────────────────────────────────────────────────

Console.WriteLine($"[simulator] waiting {startupDelaySec}s for services to start...");
await Task.Delay(TimeSpan.FromSeconds(startupDelaySec));

// ── Build scenario list ───────────────────────────────────────────────────────

List<ScenarioDef> scenarios;

if (scenarioCount > 0)
{
    scenarios = [];
    for (var n = 1; n <= scenarioCount; n++)
    {
        var sFlagKey      = Env($"SCENARIO_{n}_FLAG_KEY",       "");
        var sMetricEvt    = Env($"SCENARIO_{n}_METRIC_EVENT",   "");
        var sVariantsRaw  = Env($"SCENARIO_{n}_VARIANTS",       "control,treatment");
        var sRatesRaw     = Env($"SCENARIO_{n}_CONV_RATES",     "0.3,0.4");
        var sWeightsRaw   = Env($"SCENARIO_{n}_VARIANT_WEIGHTS", "");
        var sLayerId      = Env($"SCENARIO_{n}_LAYER_ID",        "");
        var sLayerOff     = int.Parse(Env($"SCENARIO_{n}_LAYER_OFFSET",  "0"));
        var sLayerPct     = int.Parse(Env($"SCENARIO_{n}_LAYER_PERCENT", "100"));
        var sGuardrailRaw = Env($"SCENARIO_{n}_GUARDRAIL_EVENTS", "");

        if (string.IsNullOrEmpty(sFlagKey) || string.IsNullOrEmpty(sMetricEvt))
        {
            Console.Error.WriteLine($"[simulator] SCENARIO_{n} missing FLAG_KEY or METRIC_EVENT — skipped");
            continue;
        }

        var variants = sVariantsRaw.Split(',', StringSplitOptions.TrimEntries);
        var rates    = sRatesRaw.Split(',', StringSplitOptions.TrimEntries)
                                .Select(double.Parse).ToArray();

        int[] buckets;
        if (!string.IsNullOrEmpty(sWeightsRaw))
        {
            var weights = sWeightsRaw.Split(',', StringSplitOptions.TrimEntries)
                                     .Select(int.Parse).ToArray();
            buckets = BuildCumulativeBuckets(weights);
        }
        else
        {
            var equal   = Enumerable.Repeat(100 / variants.Length, variants.Length).ToArray();
            equal[^1]  += 100 - equal.Sum();
            buckets     = BuildCumulativeBuckets(equal);
        }

        var guardrails = new List<GuardrailEvent>();
        if (!string.IsNullOrEmpty(sGuardrailRaw))
        {
            foreach (var entry in sGuardrailRaw.Split(',', StringSplitOptions.TrimEntries))
            {
                var parts = entry.Split(':', StringSplitOptions.TrimEntries);
                if (parts.Length < 2) continue;
                var evtRates = parts[1..].Select(double.Parse).ToArray();
                guardrails.Add(new GuardrailEvent(parts[0], evtRates));
            }
        }

        var def = new ScenarioDef
        {
            FlagKey         = sFlagKey,
            MetricEvent     = sMetricEvt,
            Variants        = variants,
            ConvRates       = rates,
            VariantBuckets  = buckets,
            LayerId         = string.IsNullOrEmpty(sLayerId) ? null : sLayerId,
            LayerOffset     = sLayerOff,
            LayerPercent    = sLayerPct,
            GuardrailEvents = [.. guardrails],
        };
        scenarios.Add(def);
        Console.WriteLine($"[simulator] scenario {n}: flag={sFlagKey} variants=[{string.Join(",", variants)}] " +
                          $"layer={sLayerId ?? "none"} offset={sLayerOff} pct={sLayerPct}%");
    }

    Console.WriteLine($"[simulator] multi-scenario mode — {scenarios.Count} scenario(s) loaded");
}
else
{
    // ── Legacy single-scenario mode (backward-compatible) ─────────────────────
    var flagKey     = Env("FLAG_KEY",          "onboarding-checklist");
    var expId       = Env("EXPERIMENT_ID",     "");
    var ctrlVariant = Env("CONTROL_VARIANT",   "control");
    var trtVariant  = Env("TREATMENT_VARIANT", "checklist");
    var metricEvent = Env("METRIC_EVENT",      "onboarding_completed");
    var ctrlRate    = double.Parse(Env("CONTROL_CONV_RATE",   "0.32"));
    var trtRate     = double.Parse(Env("TREATMENT_CONV_RATE", "0.45"));

    _ = expId; // preserved variable, not used in multi-variant path

    scenarios =
    [
        new ScenarioDef
        {
            FlagKey         = flagKey,
            MetricEvent     = metricEvent,
            Variants        = [ctrlVariant, trtVariant],
            ConvRates       = [ctrlRate, trtRate],
            VariantBuckets  = [50, 100],
            LayerId         = null,
            LayerOffset     = 0,
            LayerPercent    = 100,
            GuardrailEvents = [],
        }
    ];
    Console.WriteLine($"[simulator] single-scenario mode — flag={flagKey}");
}

// ── Setup ─────────────────────────────────────────────────────────────────────

var rng = new Random();

Console.WriteLine($"[simulator] target: {trackApiUrl}");
Console.WriteLine($"[simulator] batch size: {batchSize} users every {batchDelayMs}ms (continuous mode)");

// ── Continuous simulation loop ────────────────────────────────────────────────

using var http = new HttpClient();
http.DefaultRequestHeaders.Add("Authorization", envSecret);

var totalFlagEvals = 0;
var totalMetrics   = 0;
var batchNum       = 0;
var userCounter    = 0;

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

        var allVariations = new List<FlagEvalDto>();
        var allMetrics    = new List<MetricEventDto>();

        // Base timestamp: a random moment in the last 2 minutes
        var evalTime = DateTimeOffset.UtcNow.AddSeconds(-rng.Next(0, 120));
        var evalTs   = evalTime.ToUnixTimeSeconds();

        foreach (var s in scenarios)
        {
            // ── Layer bucket check ────────────────────────────────────────────
            if (!IsInLayer(userId, s.LayerId, s.LayerOffset, s.LayerPercent))
                continue;

            // ── Variant assignment ────────────────────────────────────────────
            var variantIdx = AssignVariantIndex(userId, s.FlagKey, s.VariantBuckets);
            var variant    = s.Variants[variantIdx];
            var convRate   = variantIdx < s.ConvRates.Length ? s.ConvRates[variantIdx] : 0.0;

            allVariations.Add(new FlagEvalDto
            {
                FlagKey   = s.FlagKey,
                Variant   = variant,
                LayerId   = s.LayerId,
                Timestamp = evalTs,
            });
            totalFlagEvals++;

            // ── Primary metric event ──────────────────────────────────────────
            if (rng.NextDouble() < convRate)
            {
                var convDelay = TimeSpan.FromMinutes(rng.Next(1, 15));
                var convTime  = evalTime.Add(convDelay);
                if (convTime <= DateTimeOffset.UtcNow)
                {
                    allMetrics.Add(new MetricEventDto
                    {
                        EventName = s.MetricEvent,
                        Timestamp = convTime.ToUnixTimeSeconds(),
                        AppType   = "Web",
                    });
                    totalMetrics++;
                }
            }

            // ── Guardrail metric events ───────────────────────────────────────
            foreach (var g in s.GuardrailEvents)
            {
                var gRate = variantIdx < g.Rates.Length ? g.Rates[variantIdx] : 0.0;
                if (rng.NextDouble() < gRate)
                {
                    var gDelay = TimeSpan.FromMinutes(rng.Next(0, 10));
                    var gTime  = evalTime.Add(gDelay);
                    if (gTime <= DateTimeOffset.UtcNow)
                    {
                        allMetrics.Add(new MetricEventDto
                        {
                            EventName = g.EventName,
                            Timestamp = gTime.ToUnixTimeSeconds(),
                            AppType   = "Web",
                        });
                    }
                }
            }
        }

        if (allVariations.Count == 0)
            continue; // user didn't land in any scenario this batch

        batch.Add(new TrackPayload
        {
            User = new EndUserDto
            {
                KeyId      = userId,
                Name       = $"User {userId}",
                Properties = new Dictionary<string, string>
                {
                    ["plan"]   = rng.NextDouble() < 0.3 ? "premium" : "free",
                    ["region"] = PickRandom(rng, ["US", "EU", "APAC"]),
                    ["device"] = rng.NextDouble() < 0.6 ? "desktop" : "mobile",
                },
            },
            Variations = allVariations,
            Metrics    = allMetrics,
        });
    }

    if (batch.Count == 0)
    {
        try { await Task.Delay(batchDelayMs, cts.Token); }
        catch (OperationCanceledException) { break; }
        continue;
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
    catch (OperationCanceledException) { break; }
    catch (HttpRequestException ex)
    {
        Console.Error.WriteLine($"[simulator] batch {batchNum} error: {ex.Message} — retrying in 5s");
        await Task.Delay(5000, cts.Token).ContinueWith(_ => { });
    }

    try { await Task.Delay(batchDelayMs, cts.Token); }
    catch (OperationCanceledException) { break; }
}

Console.WriteLine();
Console.WriteLine($"[simulator] stopped — sent {totalFlagEvals} evals, {totalMetrics} metrics total");

// ── Layer check ───────────────────────────────────────────────────────────────

static bool IsInLayer(string userId, string? layerId, int offset, int percent)
{
    if (layerId is null || percent >= 100)
        return true;

    var bucket = Math.Abs(StableHash(userId + "~layer~" + layerId)) % 100;
    var end    = offset + percent;

    if (end <= 100)
        return bucket >= offset && bucket < end;

    // Wrap-around window: [offset, 100) ∪ [0, end % 100)
    return bucket >= offset || bucket < end % 100;
}

// ── Variant assignment ────────────────────────────────────────────────────────

static int AssignVariantIndex(string userId, string flagKey, int[] cumulativeBuckets)
{
    var bucket = Math.Abs(StableHash(userId + "~variant~" + flagKey)) % 100;
    for (var i = 0; i < cumulativeBuckets.Length; i++)
        if (bucket < cumulativeBuckets[i])
            return i;
    return cumulativeBuckets.Length - 1;
}

// ── Build cumulative bucket boundaries from weight array ──────────────────────
// e.g. [50, 50] → [50, 100]   |   [12, 72, 16] → [12, 84, 100]

static int[] BuildCumulativeBuckets(int[] weights)
{
    var cumulative = new int[weights.Length];
    var sum = 0;
    for (var i = 0; i < weights.Length; i++)
    {
        sum += weights[i];
        cumulative[i] = sum;
    }
    if (cumulative.Length > 0)
        cumulative[^1] = 100; // clamp to avoid off-by-one
    return cumulative;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

static string Env(string name, string defaultValue) =>
    Environment.GetEnvironmentVariable(name) ?? defaultValue;

static int StableHash(string input)
{
    var bytes = Encoding.UTF8.GetBytes(input);
    var hash  = SHA256.HashData(bytes);
    return BitConverter.ToInt32(hash, 0);
}

static T PickRandom<T>(Random rng, T[] items) => items[rng.Next(items.Length)];

// ── Data types ────────────────────────────────────────────────────────────────

class ScenarioDef
{
    public string FlagKey { get; set; } = "";
    public string MetricEvent { get; set; } = "";
    public string[] Variants { get; set; } = [];
    public double[] ConvRates { get; set; } = [];
    /// <summary>Cumulative bucket thresholds (0–100). Length == Variants.Length.</summary>
    public int[] VariantBuckets { get; set; } = [];
    public string? LayerId { get; set; }
    public int LayerOffset { get; set; }
    public int LayerPercent { get; set; } = 100;
    public GuardrailEvent[] GuardrailEvents { get; set; } = [];
}

/// <summary>
/// A single guardrail metric event.
/// Rates[i] is the per-session firing probability for Variants[i].
/// </summary>
record GuardrailEvent(string EventName, double[] Rates);

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
    public string? LayerId { get; set; }
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
