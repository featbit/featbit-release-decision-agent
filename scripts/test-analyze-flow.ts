#!/usr/bin/env npx tsx
/**
 * End-to-end test: Cloudflare TSDB → Data Server /analyze → Bayesian result
 *
 * Prerequisites:
 *   - Cloudflare TSDB deployed at tsdb.featbit.ai (or override TSDB_URL)
 *   - Data server running locally: cd agent/data && dotnet run
 *     OR via docker: docker compose up data
 *
 * Usage:
 *   npx tsx scripts/test-analyze-flow.ts
 *
 * What it does:
 *   1. Sends synthetic flag-eval + metric events to Cloudflare TSDB (POST /api/track)
 *   2. Waits briefly for Cloudflare Durable Objects to flush
 *   3. Calls POST /analyze on the local data server
 *      (MetricCollector queries Cloudflare TSDB → PythonAnalyzer runs Bayesian analysis)
 *   4. Prints the full pipeline result
 */

// ── Config ────────────────────────────────────────────────────────────────────

const TSDB_URL = process.env.TSDB_URL ?? "https://tsdb.featbit.ai";
const DATA_URL = process.env.DATA_URL ?? "http://localhost:5058";

const ENV_ID = "test-env-001";
const FLAG_KEY = "test-onboarding";
const METRIC_EVENT = "signup-complete";
const CONTROL_VARIANT = "false";
const TREATMENT_VARIANT = "true";

const CONTROL_USERS = 60;
const TREATMENT_USERS = 60;
const CONTROL_CONV_RATE = 0.30; // 30% conversion
const TREATMENT_CONV_RATE = 0.45; // 45% conversion

// ── Helpers ───────────────────────────────────────────────────────────────────

function nowUnixSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

interface TrackPayload {
  user: { keyId: string };
  variations: {
    flagKey: string;
    variant: string;
    sendToExperiment: boolean;
    timestamp: number;
  }[];
  metrics: {
    eventName: string;
    timestamp: number;
  }[];
}

function buildPayloads(): TrackPayload[] {
  const payloads: TrackPayload[] = [];
  const baseTs = nowUnixSeconds() - 3600; // 1 hour ago

  // Control users
  for (let i = 0; i < CONTROL_USERS; i++) {
    const userKey = `ctrl-user-${i}`;
    const ts = baseTs + i * 10;
    const converted = Math.random() < CONTROL_CONV_RATE;

    payloads.push({
      user: { keyId: userKey },
      variations: [
        {
          flagKey: FLAG_KEY,
          variant: CONTROL_VARIANT,
          sendToExperiment: true,
          timestamp: ts,
        },
      ],
      metrics: converted
        ? [{ eventName: METRIC_EVENT, timestamp: ts + 5 }]
        : [],
    });
  }

  // Treatment users
  for (let i = 0; i < TREATMENT_USERS; i++) {
    const userKey = `trt-user-${i}`;
    const ts = baseTs + (CONTROL_USERS + i) * 10;
    const converted = Math.random() < TREATMENT_CONV_RATE;

    payloads.push({
      user: { keyId: userKey },
      variations: [
        {
          flagKey: FLAG_KEY,
          variant: TREATMENT_VARIANT,
          sendToExperiment: true,
          timestamp: ts,
        },
      ],
      metrics: converted
        ? [{ eventName: METRIC_EVENT, timestamp: ts + 5 }]
        : [],
    });
  }

  return payloads;
}

// ── Step 1: Seed data into TSDB ──────────────────────────────────────────────

async function seedData(payloads: TrackPayload[]): Promise<void> {
  console.log(`\n🔹 Step 1: Seeding ${payloads.length} track events into TSDB...`);

  const resp = await fetch(`${TSDB_URL}/api/track`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: ENV_ID,
    },
    body: JSON.stringify(payloads),
  });

  if (!resp.ok) {
    throw new Error(`TSDB track failed: ${resp.status} ${await resp.text()}`);
  }

  const controlConversions = payloads
    .filter((p) => p.variations[0].variant === CONTROL_VARIANT && p.metrics.length > 0).length;
  const treatmentConversions = payloads
    .filter((p) => p.variations[0].variant === TREATMENT_VARIANT && p.metrics.length > 0).length;

  console.log(`   ✅ Sent ${CONTROL_USERS} control users (${controlConversions} conversions)`);
  console.log(`   ✅ Sent ${TREATMENT_USERS} treatment users (${treatmentConversions} conversions)`);
}

// ── Step 2: Wait for TSDB flush ──────────────────────────────────────────────

async function waitForFlush(): Promise<void> {
  console.log(`\n🔹 Step 2: Waiting 5s for Cloudflare DO flush + R2 write...`);
  await new Promise((resolve) => setTimeout(resolve, 5000));
  console.log(`   ✅ Flush window elapsed`);
}

// ── Step 2.5: Verify data landed in Cloudflare TSDB ─────────────────────────

async function verifyTsdbQuery(): Promise<void> {
  console.log(`\n🔹 Step 2.5: Querying Cloudflare TSDB directly to verify data...`);

  const now = new Date();
  const twoHoursAgo = new Date(now.getTime() - 2 * 60 * 60 * 1000);

  const queryBody = {
    envId: ENV_ID,
    flagKey: FLAG_KEY,
    metricEvent: METRIC_EVENT,
    metricType: "binary",
    metricAgg: "once",
    controlVariant: CONTROL_VARIANT,
    treatmentVariant: TREATMENT_VARIANT,
    start: twoHoursAgo.toISOString(),
    end: now.toISOString(),
  };

  const resp = await fetch(`${TSDB_URL}/api/query/experiment`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(queryBody),
  });

  if (!resp.ok) {
    console.log(`   ⚠️ TSDB query returned ${resp.status}: ${await resp.text()}`);
    return;
  }

  const result = await resp.json() as {
    metricType: string;
    variants: Record<string, { n: number; k?: number }>;
  };
  console.log(`   TSDB query result:`, JSON.stringify(result, null, 2));

  const ctrlN = result.variants?.[CONTROL_VARIANT]?.n ?? 0;
  const trtN = result.variants?.[TREATMENT_VARIANT]?.n ?? 0;
  console.log(`   ✅ Control: n=${ctrlN}, k=${result.variants?.[CONTROL_VARIANT]?.k ?? 0}`);
  console.log(`   ✅ Treatment: n=${trtN}, k=${result.variants?.[TREATMENT_VARIANT]?.k ?? 0}`);

  if (ctrlN === 0 && trtN === 0) {
    console.log(`   ⚠️ No data returned — DO flush may need more time`);
  }
}

// ── Step 3: Call /analyze on the data server ─────────────────────────────────

async function callAnalyze(): Promise<{ inputData: string; analysisResult: string }> {
  console.log(`\n🔹 Step 3: Calling POST ${DATA_URL}/analyze ...`);

  const now = new Date();
  const twoHoursAgo = new Date(now.getTime() - 2 * 60 * 60 * 1000);

  const body = {
    slug: "e2e-test",
    envId: ENV_ID,
    flagKey: FLAG_KEY,
    primaryMetricEvent: METRIC_EVENT,
    primaryMetricType: "binary",
    primaryMetricAgg: "once",
    controlVariant: CONTROL_VARIANT,
    treatmentVariant: TREATMENT_VARIANT,
    observationStart: twoHoursAgo.toISOString(),
    observationEnd: now.toISOString(),
  };

  console.log(`   Request body:`, JSON.stringify(body, null, 2));

  const resp = await fetch(`${DATA_URL}/analyze`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  const text = await resp.text();

  if (!resp.ok) {
    throw new Error(`Analyze call failed: ${resp.status} ${text}`);
  }

  return JSON.parse(text);
}

// ── Step 4: Print results ────────────────────────────────────────────────────

function printResults(result: { inputData: string; analysisResult: string }): void {
  console.log(`\n🔹 Step 4: Results`);

  if (result.inputData) {
    console.log(`\n── Input Data (from TSDB) ──`);
    try {
      console.log(JSON.stringify(JSON.parse(result.inputData), null, 2));
    } catch {
      console.log(result.inputData);
    }
  }

  if (result.analysisResult) {
    console.log(`\n── Bayesian Analysis Result ──`);
    try {
      console.log(JSON.stringify(JSON.parse(result.analysisResult), null, 2));
    } catch {
      console.log(result.analysisResult);
    }
  }

  if (!result.inputData && !result.analysisResult) {
    console.log(`   ⚠️ No data returned — check if TSDB and data server are running`);
  }
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log("═══════════════════════════════════════════════════════════════");
  console.log(" E2E Test: TSDB → Data Server /analyze → Bayesian Analysis");
  console.log("═══════════════════════════════════════════════════════════════");
  console.log(`  TSDB:      ${TSDB_URL}`);
  console.log(`  Data:      ${DATA_URL}`);
  console.log(`  Env:       ${ENV_ID}`);
  console.log(`  Flag:      ${FLAG_KEY}`);
  console.log(`  Metric:    ${METRIC_EVENT}`);
  console.log(`  Users:     ${CONTROL_USERS} ctrl + ${TREATMENT_USERS} trt`);

  // Check health first
  try {
    // Cloudflare TSDB has /api/stats instead of /health
    const tsdbHealth = await fetch(`${TSDB_URL}/api/stats`);
    if (!tsdbHealth.ok) throw new Error("TSDB not reachable");
    console.log(`   TSDB stats:`, await tsdbHealth.json());
  } catch (e) {
    console.error(`\n❌ TSDB is not reachable at ${TSDB_URL}`);
    console.error(`   Error: ${(e as Error).message}`);
    process.exit(1);
  }

  try {
    const dataHealth = await fetch(`${DATA_URL}/health`);
    if (!dataHealth.ok) throw new Error("Data server not healthy");
  } catch {
    console.error(`\n❌ Data server is not reachable at ${DATA_URL}. Run: cd agent/data && dotnet run`);
    process.exit(1);
  }

  console.log(`\n  ✅ Both services are healthy`);

  const payloads = buildPayloads();

  await seedData(payloads);
  await waitForFlush();
  await verifyTsdbQuery();
  const result = await callAnalyze();
  printResults(result);

  console.log("\n═══════════════════════════════════════════════════════════════");
  console.log(" Test complete!");
  console.log("═══════════════════════════════════════════════════════════════\n");
}

main().catch((err) => {
  console.error("\n❌ Test failed:", err.message ?? err);
  process.exit(1);
});
