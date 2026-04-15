/**
 * Continuously generate synthetic /api/track payloads so the rolled-up
 * analysis for run-active-test stays fresh.
 *
 * Each tick (default 5 s) picks a random number in [0, MAX_EVENTS_PER_TICK]
 * and emits that many payloads. Each payload:
 *   - one flag evaluation (random variant, weighted by control/treatment conv rates)
 *   - maybe a primary-metric conversion event
 *   - maybe a guardrail metric event
 */

import {
  ENV_ID,
  FLAG_KEY,
  EXPERIMENT_ID,
  CONTROL_VARIANT,
  TREATMENT_VARIANT,
  PRIMARY_METRIC_EVENT,
  GUARDRAIL_EVENTS,
  CONTROL_CONV_RATE,
  TREATMENT_CONV_RATE,
  GUARDRAIL_FIRE_RATE,
} from "./config.ts";

const WORKER_URL          = process.env.WORKER_URL          ?? "http://localhost:8787";
const TICK_SECONDS        = parseInt(process.env.TICK_SECONDS        ?? "5",  10);
const MAX_EVENTS_PER_TICK = parseInt(process.env.MAX_EVENTS_PER_TICK ?? "10", 10);

// ── Payload type (mirror of cf-worker TrackPayload) ───────────────────────────

interface TrackPayload {
  user: { keyId: string };
  variations?: Array<{ flagKey: string; variant: string; timestamp: number; experimentId?: string }>;
  metrics?:    Array<{ eventName: string; timestamp: number; numericValue?: number }>;
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function randInt(maxInclusive: number): number {
  return Math.floor(Math.random() * (maxInclusive + 1));
}

function randomUserKey(): string {
  // 100k user pool — wide enough that per-user collisions are rare
  return `rat-user-${Math.floor(Math.random() * 100_000).toString().padStart(6, "0")}`;
}

function buildPayload(): TrackPayload {
  const nowSec  = Math.floor(Date.now() / 1000);
  const variant = Math.random() < 0.5 ? CONTROL_VARIANT : TREATMENT_VARIANT;
  const userKey = randomUserKey();

  const payload: TrackPayload = {
    user: { keyId: userKey },
    variations: [{
      flagKey:      FLAG_KEY,
      variant,
      timestamp:    nowSec,
      experimentId: EXPERIMENT_ID,
    }],
    metrics: [],
  };

  // Primary conversion
  const convRate = variant === TREATMENT_VARIANT ? TREATMENT_CONV_RATE : CONTROL_CONV_RATE;
  if (Math.random() < convRate) {
    payload.metrics!.push({ eventName: PRIMARY_METRIC_EVENT, timestamp: nowSec });
  }

  // Guardrail — at most one per payload, low probability
  if (Math.random() < GUARDRAIL_FIRE_RATE) {
    const guardrail = GUARDRAIL_EVENTS[randInt(GUARDRAIL_EVENTS.length - 1)];
    payload.metrics!.push({ eventName: guardrail, timestamp: nowSec });
  }

  if (payload.metrics!.length === 0) delete payload.metrics;
  return payload;
}

async function sendBatch(payloads: TrackPayload[]): Promise<void> {
  const res = await fetch(`${WORKER_URL}/api/track`, {
    method:  "POST",
    headers: { "Content-Type": "application/json", "Authorization": ENV_ID },
    body:    JSON.stringify(payloads),
  });
  if (!res.ok) throw new Error(`/api/track ${res.status}: ${await res.text()}`);
}

// ── Main loop ─────────────────────────────────────────────────────────────────

export async function runGeneratorLoop(): Promise<void> {
  console.log(`[generator] started  tick=${TICK_SECONDS}s  maxEvents=${MAX_EVENTS_PER_TICK}  worker=${WORKER_URL}`);

  let totalEvents = 0;
  let totalTicks  = 0;

  // Heartbeat log every 60s so we know it's alive without being chatty
  const heartbeat = setInterval(() => {
    console.log(`[generator] alive  ticks=${totalTicks}  totalEvents=${totalEvents}`);
  }, 60_000);

  // Graceful shutdown
  const shutdown = () => {
    clearInterval(heartbeat);
    console.log(`[generator] stopped  ticks=${totalTicks}  totalEvents=${totalEvents}`);
    process.exit(0);
  };
  process.on("SIGINT",  shutdown);
  process.on("SIGTERM", shutdown);

  while (true) {
    const n = randInt(MAX_EVENTS_PER_TICK);
    if (n > 0) {
      const payloads = Array.from({ length: n }, buildPayload);
      try {
        await sendBatch(payloads);
        totalEvents += n;
      } catch (e) {
        console.error(`[generator] tick failed: ${(e as Error).message}`);
      }
    }
    totalTicks++;
    await new Promise((r) => setTimeout(r, TICK_SECONDS * 1000));
  }
}
