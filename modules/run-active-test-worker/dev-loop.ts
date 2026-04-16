/**
 * Simple local loop for docker-compose — every TICK_MS sends 0–MAX_EVENTS
 * random TrackPayloads to WORKER_URL/api/track.
 *
 * No Cloudflare, no wrangler, just a plain fetch() in a setInterval.
 */

const WORKER_URL = process.env.WORKER_URL ?? "http://track-service:8080";
const ENV_ID     = process.env.ENV_ID     ?? "rat-env-v1";
const TICK_MS    = parseInt(process.env.TICK_MS        ?? "5000", 10);
const MAX_EVENTS = parseInt(process.env.MAX_EVENTS     ?? "8",    10);

const FLAG_KEY            = "run-active-test";
const EXPERIMENT_ID       = "a0000000-0000-0000-0000-000000000001";
const CONTROL             = "control";
const TREATMENT           = "treatment";
const PRIMARY_METRIC      = "checkout-completed";
const GUARDRAILS          = ["page-load-error", "rage-click", "session-bounce"];
const CONTROL_CONV_RATE   = 0.15;
const TREATMENT_CONV_RATE = 0.20;
const GUARDRAIL_FIRE_RATE = 0.05;

interface TrackPayload {
  user: { keyId: string };
  variations?: { flagKey: string; variant: string; timestamp: number; experimentId?: string }[];
  metrics?:    { eventName: string; timestamp: number }[];
}

function randInt(max: number): number {
  return Math.floor(Math.random() * (max + 1));
}

function buildPayload(): TrackPayload {
  const now     = Math.floor(Date.now() / 1000);
  const variant = Math.random() < 0.5 ? CONTROL : TREATMENT;
  const userKey = `rat-user-${Math.floor(Math.random() * 100_000).toString().padStart(6, "0")}`;

  const p: TrackPayload = {
    user: { keyId: userKey },
    variations: [{ flagKey: FLAG_KEY, variant, timestamp: now, experimentId: EXPERIMENT_ID }],
    metrics: [],
  };

  const rate = variant === TREATMENT ? TREATMENT_CONV_RATE : CONTROL_CONV_RATE;
  if (Math.random() < rate) {
    p.metrics!.push({ eventName: PRIMARY_METRIC, timestamp: now });
  }
  if (Math.random() < GUARDRAIL_FIRE_RATE) {
    p.metrics!.push({ eventName: GUARDRAILS[randInt(GUARDRAILS.length - 1)], timestamp: now });
  }
  if (p.metrics!.length === 0) delete p.metrics;
  return p;
}

let totalEvents = 0;
let totalTicks  = 0;

async function tick(): Promise<void> {
  const n = randInt(MAX_EVENTS);
  totalTicks++;
  if (n === 0) return;

  const payloads = Array.from({ length: n }, buildPayload);
  try {
    const res = await fetch(`${WORKER_URL}/api/track`, {
      method:  "POST",
      headers: { "Content-Type": "application/json", Authorization: ENV_ID },
      body:    JSON.stringify(payloads),
    });
    if (!res.ok) throw new Error(`${res.status}: ${await res.text()}`);
    totalEvents += n;
  } catch (e) {
    console.error(`[rat] tick failed: ${(e as Error).message}`);
  }
}

// Heartbeat every 60s
setInterval(() => {
  console.log(`[rat] alive  ticks=${totalTicks}  totalEvents=${totalEvents}`);
}, 60_000);

// Graceful shutdown
function shutdown() {
  console.log(`[rat] stopped  ticks=${totalTicks}  totalEvents=${totalEvents}`);
  process.exit(0);
}
process.on("SIGINT",  shutdown);
process.on("SIGTERM", shutdown);

// Main loop
console.log(`[rat] started  tick=${TICK_MS}ms  maxEvents=${MAX_EVENTS}  url=${WORKER_URL}`);
setInterval(tick, TICK_MS);
