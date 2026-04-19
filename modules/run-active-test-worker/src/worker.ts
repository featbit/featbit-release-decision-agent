/**
 * run-active-test-worker
 *
 * Cron-triggered Worker that keeps the run-active-test canary experiment fed
 * with synthetic events. Every minute, the scheduled handler runs N bursts
 * spaced BURST_INTERVAL_MS apart — each burst fires a real HTTP POST to
 * cf-worker's /api/track, so this worker also doubles as an end-to-end health
 * probe of the public HTTP surface.
 *
 * There is intentionally no /fetch handler. This worker exists solely to be
 * woken up by the cron trigger.
 */

import {
  FLAG_KEY,
  EXPERIMENT_ID,
  CONTROL_VARIANT,
  TREATMENT_VARIANT,
  PRIMARY_METRIC_EVENT,
  GUARDRAIL_EVENTS,
  CONTROL_CONV_RATE,
  TREATMENT_CONV_RATE,
  GUARDRAIL_FIRE_RATE,
} from "./config";

// ── Env bindings (from wrangler.jsonc vars) ───────────────────────────────────

interface Env {
  WORKER_URL:            string;
  ENV_ID:                string;
  BURSTS_PER_INVOCATION: string;
  BURST_INTERVAL_MS:     string;
  MAX_EVENTS_PER_BURST:  string;
}

// ── TrackPayload (mirror of cf-worker type) ───────────────────────────────────

interface TrackPayload {
  user: { keyId: string };
  variations?: Array<{
    flagKey:      string;
    variant:      string;
    timestamp:    number;         // epoch milliseconds
    experimentId?: string;
  }>;
  metrics?: Array<{
    eventName:    string;
    timestamp:    number;         // epoch milliseconds
    numericValue?: number;
  }>;
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function randInt(maxInclusive: number): number {
  return Math.floor(Math.random() * (maxInclusive + 1));
}

function randomUserKey(): string {
  return `rat-user-${Math.floor(Math.random() * 100_000).toString().padStart(6, "0")}`;
}

function buildPayload(): TrackPayload {
  const nowMs   = Date.now();
  const variant = Math.random() < 0.5 ? CONTROL_VARIANT : TREATMENT_VARIANT;

  const payload: TrackPayload = {
    user: { keyId: randomUserKey() },
    variations: [{
      flagKey:      FLAG_KEY,
      variant,
      timestamp:    nowMs,
      experimentId: EXPERIMENT_ID,
    }],
    metrics: [],
  };

  // Primary conversion — fires after exposure so metric.ts > exposure.ts
  const convRate = variant === TREATMENT_VARIANT ? TREATMENT_CONV_RATE : CONTROL_CONV_RATE;
  if (Math.random() < convRate) {
    payload.metrics!.push({ eventName: PRIMARY_METRIC_EVENT, timestamp: nowMs + 1 });
  }

  // Guardrail — at most one per payload, also strictly post-exposure
  if (Math.random() < GUARDRAIL_FIRE_RATE) {
    payload.metrics!.push({
      eventName: GUARDRAIL_EVENTS[randInt(GUARDRAIL_EVENTS.length - 1)],
      timestamp: nowMs + 1,
    });
  }

  if (payload.metrics!.length === 0) delete payload.metrics;
  return payload;
}

async function sendBurst(env: Env, n: number): Promise<void> {
  if (n === 0) return;
  const payloads: TrackPayload[] = Array.from({ length: n }, buildPayload);
  const res = await fetch(`${env.WORKER_URL}/api/track`, {
    method:  "POST",
    headers: {
      "Content-Type":  "application/json",
      "Authorization": env.ENV_ID,
    },
    body: JSON.stringify(payloads),
  });
  if (!res.ok) {
    throw new Error(`/api/track ${res.status}: ${await res.text()}`);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// ── Worker entry points ───────────────────────────────────────────────────────

export default {
  async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
    const bursts  = parseInt(env.BURSTS_PER_INVOCATION, 10) || 12;
    const gapMs   = parseInt(env.BURST_INTERVAL_MS,     10) || 5000;
    const maxN    = parseInt(env.MAX_EVENTS_PER_BURST,  10) || 10;

    ctx.waitUntil((async () => {
      let sent = 0;
      let fails = 0;
      for (let i = 0; i < bursts; i++) {
        const n = randInt(maxN);
        try {
          await sendBurst(env, n);
          sent += n;
        } catch (err) {
          fails++;
          console.error(`[rat-worker] burst ${i} failed: ${(err as Error).message}`);
        }
        if (i < bursts - 1) await sleep(gapMs);
      }
      console.log(`[rat-worker] cron=${event.cron} bursts=${bursts} sent=${sent} fails=${fails}`);
    })());
  },
};
