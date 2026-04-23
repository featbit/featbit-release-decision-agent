/**
 * Simple local loop for docker-compose — every TICK_MS sends 0–MAX_EVENTS
 * random TrackPayloads per configured experiment to WORKER_URL/api/track.
 *
 * Each entry in EXPERIMENTS is a self-contained (env, flag, metric, variants)
 * bundle. On each tick we generate events for every entry in parallel.
 */

import { signEnvSecret } from "./src/env-secret";

const WORKER_URL   = process.env.WORKER_URL ?? "https://track.featbit.ai";
const TICK_MS      = parseInt(process.env.TICK_MS    ?? "5000", 10);
const MAX_EVENTS   = parseInt(process.env.MAX_EVENTS ?? "8",    10);
const SIGNING_KEY  = process.env.TRACK_SERVICE_SIGNING_KEY;

interface ExperimentConfig {
  envId:              string;
  flagKey:            string;
  experimentId:       string;
  variants:           { name: string; trafficWeight: number; convRate: number }[];
  primaryMetric:      string;
  guardrails:         string[];
  guardrailFireRate:  number;
  userKeyPrefix:      string;
  userKeySpace:       number;
}

const EXPERIMENTS: ExperimentConfig[] = [
  // Classic run-active-test demo (kept from the original loop)
  {
    envId:              process.env.ENV_ID ?? "rat-env-v1",
    flagKey:            "run-active-test",
    experimentId:       "a0000000-0000-0000-0000-000000000001",
    variants: [
      { name: "control",   trafficWeight: 0.5, convRate: 0.15 },
      { name: "treatment", trafficWeight: 0.5, convRate: 0.20 },
    ],
    primaryMetric:      "checkout-completed",
    guardrails:         ["page-load-error", "rage-click", "session-bounce"],
    guardrailFireRate:  0.05,
    userKeyPrefix:      "rat-user",
    userKeySpace:       100_000,
  },
  // Hero title experiment on featbit.co
  {
    envId:              "test-env-0001",
    flagKey:            "hero-title-experiment",
    experimentId:       "b0000000-0000-0000-0000-000000000002",
    variants: [
      { name: "original_title",        trafficWeight: 0.5, convRate: 0.12 },
      { name: "experimentation_title", trafficWeight: 0.5, convRate: 0.15 },
    ],
    primaryMetric:      "pricing_page_click",
    // page_view fires very often (near-universal); other_cta_click is rare.
    // Fire rates live on each guardrail below, via inline index.
    guardrails:         ["page_view", "other_cta_click"],
    guardrailFireRate:  0.5, // averaged across the two; sampled below
    userKeyPrefix:      "hero-user",
    userKeySpace:       50_000,
  },
  // "jd" experiment (3c30d880-…) — env 66cf64af-… / flag gsaafsd.
  // Rates chosen to match the stored inputData totals (2% vs 3.5% primary,
  // ~10–12% guardrail) so live results line up with what the expert setup
  // originally pasted.
  {
    envId:              "66cf64af-7cdd-4779-9434-4ae5b4df20f3",
    flagKey:            "gsaafsd",
    experimentId:       "3c30d880-c3f6-4a9a-9210-93cb48ca7116",
    variants: [
      { name: "control",   trafficWeight: 0.5, convRate: 0.020 },
      { name: "treatment", trafficWeight: 0.5, convRate: 0.035 },
    ],
    primaryMetric:      "test",
    guardrails:         ["testg"],
    guardrailFireRate:  0.11,
    userKeyPrefix:      "jd-user",
    userKeySpace:       100_000,
  },
];

interface TrackPayload {
  // timestamps are epoch milliseconds — track-service enforces
  // metric.ts >= exposure.ts so metric events fire at or after exposure.
  user: { keyId: string };
  variations?: { flagKey: string; variant: string; timestamp: number; experimentId?: string }[];
  metrics?:    { eventName: string; timestamp: number }[];
}

function randInt(max: number): number {
  return Math.floor(Math.random() * (max + 1));
}

/** Pick a variant respecting trafficWeight (weights should sum to ~1). */
function pickVariant(cfg: ExperimentConfig): ExperimentConfig["variants"][number] {
  const r = Math.random();
  let cum = 0;
  for (const v of cfg.variants) {
    cum += v.trafficWeight;
    if (r < cum) return v;
  }
  return cfg.variants[cfg.variants.length - 1];
}

function buildPayload(cfg: ExperimentConfig): TrackPayload {
  const exposureMs = Date.now();
  const metricMs   = exposureMs + 1;       // strictly after exposure
  const variant = pickVariant(cfg);
  const userKey = `${cfg.userKeyPrefix}-${Math.floor(Math.random() * cfg.userKeySpace).toString().padStart(6, "0")}`;

  const p: TrackPayload = {
    user: { keyId: userKey },
    variations: [{
      flagKey:      cfg.flagKey,
      variant:      variant.name,
      timestamp:    exposureMs,
      experimentId: cfg.experimentId,
    }],
    metrics: [],
  };

  if (Math.random() < variant.convRate) {
    p.metrics!.push({ eventName: cfg.primaryMetric, timestamp: metricMs });
  }
  // page_view fires almost every session; other guardrails fire sparsely.
  for (const g of cfg.guardrails) {
    const fire = g === "page_view" ? 0.8 : cfg.guardrailFireRate;
    if (Math.random() < fire) {
      p.metrics!.push({ eventName: g, timestamp: metricMs });
    }
  }
  if (p.metrics!.length === 0) delete p.metrics;
  return p;
}

const totals = new Map<string, number>();
let totalTicks = 0;

/**
 * Pre-signed Authorization value per envId. Computed once at startup so the
 * tick loop stays sync (no HMAC on the hot path). Falls back to raw envId when
 * TRACK_SERVICE_SIGNING_KEY is unset — matches track-service's legacy mode.
 */
const authHeaders = new Map<string, string>();

async function sendFor(cfg: ExperimentConfig): Promise<void> {
  const n = randInt(MAX_EVENTS);
  if (n === 0) return;

  const payloads = Array.from({ length: n }, () => buildPayload(cfg));
  try {
    const res = await fetch(`${WORKER_URL}/api/track`, {
      method:  "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization:  authHeaders.get(cfg.envId) ?? cfg.envId,
      },
      body:    JSON.stringify(payloads),
    });
    if (!res.ok) throw new Error(`${res.status}: ${await res.text()}`);
    totals.set(cfg.envId, (totals.get(cfg.envId) ?? 0) + n);
  } catch (e) {
    console.error(`[rat] ${cfg.envId} tick failed: ${(e as Error).message}`);
  }
}

async function tick(): Promise<void> {
  totalTicks++;
  await Promise.all(EXPERIMENTS.map(sendFor));
}

setInterval(() => {
  const summary = [...totals.entries()].map(([env, n]) => `${env}=${n}`).join(" ");
  console.log(`[rat] alive  ticks=${totalTicks}  ${summary}`);
}, 60_000);

function shutdown() {
  const summary = [...totals.entries()].map(([env, n]) => `${env}=${n}`).join(" ");
  console.log(`[rat] stopped  ticks=${totalTicks}  ${summary}`);
  process.exit(0);
}
process.on("SIGINT",  shutdown);
process.on("SIGTERM", shutdown);

async function main() {
  // Mint one token per envId up front so the tick loop is allocation-free.
  for (const cfg of EXPERIMENTS) {
    if (authHeaders.has(cfg.envId)) continue;
    authHeaders.set(cfg.envId, await signEnvSecret(cfg.envId, SIGNING_KEY));
  }

  console.log(
    `[rat] started  tick=${TICK_MS}ms  maxEvents=${MAX_EVENTS}` +
    `  signed=${SIGNING_KEY ? "yes" : "no (legacy)"}` +
    `  experiments=${EXPERIMENTS.map(e => e.envId + "/" + e.flagKey).join(",")}`
  );
  setInterval(tick, TICK_MS);
}

main().catch((e) => {
  console.error(`[rat] failed to start: ${(e as Error).message}`);
  process.exit(1);
});
