#!/usr/bin/env npx tsx
/**
 * E2E test for FeatBit TSDB Cloudflare Worker
 *
 * Usage:
 *   npx tsx scripts/e2e-test.ts <base-url>
 *
 * Example:
 *   npx tsx scripts/e2e-test.ts https://featbit-tsdb.beau-hu.workers.dev
 */

const BASE_URL = process.argv[2];
if (!BASE_URL) {
  console.error("Usage: npx tsx scripts/e2e-test.ts <base-url>");
  process.exit(1);
}

const ENV_SECRET = "e2e-test-env-001";
const FLAG_KEY = "e2e-checkout-redesign";
const EVENT_NAME = "purchase-completed";
const EXPERIMENT_ID = "exp-e2e-001";

// ── Helpers ──────────────────────────────────────────────────────────────────

let passed = 0;
let failed = 0;

function assert(condition: boolean, label: string, detail?: string) {
  if (condition) {
    console.log(`  ✅ ${label}`);
    passed++;
  } else {
    console.log(`  ❌ ${label}${detail ? ` — ${detail}` : ""}`);
    failed++;
  }
}

async function post(path: string, body: unknown, headers: Record<string, string> = {}) {
  const res = await fetch(`${BASE_URL}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
  return res;
}

async function get(path: string) {
  return fetch(`${BASE_URL}${path}`);
}

function unixNow() {
  return Math.floor(Date.now() / 1000);
}

// ── Test Data ────────────────────────────────────────────────────────────────

function buildTrackBatch(userCount: number, controlConvRate: number, treatmentConvRate: number) {
  const payloads = [];
  const ts = unixNow();

  for (let i = 0; i < userCount; i++) {
    const variant = i % 2 === 0 ? "control" : "treatment";
    const convRate = variant === "control" ? controlConvRate : treatmentConvRate;
    const userId = `e2e-user-${Date.now()}-${i}`;

    const payload: Record<string, unknown> = {
      user: { keyId: userId, name: `E2E User ${i}` },
      variations: [
        {
          flagKey: FLAG_KEY,
          variant,
          timestamp: ts + i,
          experimentId: EXPERIMENT_ID,
          sendToExperiment: true,
        },
      ],
      metrics: [] as unknown[],
    };

    // Deterministic conversion based on rate
    if (Math.random() < convRate) {
      (payload.metrics as unknown[]).push({
        eventName: EVENT_NAME,
        timestamp: ts + i + 10,
        numericValue: variant === "control" ? 25.0 : 45.0,
      });
    }

    payloads.push(payload);
  }
  return payloads;
}

// ── Tests ────────────────────────────────────────────────────────────────────

async function testHealthCheck() {
  console.log("\n🔍 Test 1: Stats endpoint (health check)");
  const res = await get("/api/stats");
  assert(res.status === 200, `GET /api/stats → ${res.status}`, "expected 200");
  const body = await res.json() as Record<string, unknown>;
  assert(typeof body === "object" && body !== null, "Response is JSON object");
  console.log(`   Response: ${JSON.stringify(body)}`);
}

async function testTrackSingleUser() {
  console.log("\n🔍 Test 2: Track single user");
  const ts = unixNow();
  const payload = [
    {
      user: { keyId: "e2e-single-user", name: "Single Test" },
      variations: [
        {
          flagKey: FLAG_KEY,
          variant: "treatment",
          timestamp: ts,
          experimentId: EXPERIMENT_ID,
          sendToExperiment: true,
        },
      ],
      metrics: [
        {
          eventName: EVENT_NAME,
          timestamp: ts + 5,
          numericValue: 39.99,
        },
      ],
    },
  ];

  const res = await post("/api/track", payload, { Authorization: ENV_SECRET });
  assert(res.status === 202, `POST /api/track → ${res.status}`, "expected 202");
}

async function testTrackBatch() {
  console.log("\n🔍 Test 3: Track batch (50 users, 30% control conv, 50% treatment conv)");
  const batch = buildTrackBatch(50, 0.3, 0.5);
  const res = await post("/api/track", batch, { Authorization: ENV_SECRET });
  assert(res.status === 202, `POST /api/track (50 users) → ${res.status}`, "expected 202");
}

async function testTrackNoAuth() {
  console.log("\n🔍 Test 4: Track without Authorization header (expect 401)");
  const payload = [
    {
      user: { keyId: "no-auth-user" },
      variations: [],
      metrics: [],
    },
  ];
  const res = await post("/api/track", payload);
  assert(res.status === 401, `POST /api/track (no auth) → ${res.status}`, "expected 401");
}

async function testTrackEmptyBody() {
  console.log("\n🔍 Test 5: Track with empty array (expect 400 — nothing to ingest)");
  const res = await post("/api/track", [], { Authorization: ENV_SECRET });
  assert(res.status === 400, `POST /api/track ([]) → ${res.status}`, "expected 400");
}

async function testStatsAfterIngest() {
  console.log("\n🔍 Test 6: Stats after ingestion (segments should exist)");
  const res = await get("/api/stats");
  assert(res.status === 200, `GET /api/stats → ${res.status}`);
  const body = await res.json() as Record<string, Record<string, number>>;
  console.log(`   Response: ${JSON.stringify(body)}`);
  const feSegments = body["flag-evals"]?.segments ?? 0;
  const meSegments = body["metric-events"]?.segments ?? 0;
  const totalSegments = feSegments + meSegments;
  assert(totalSegments > 0, `totalSegments = ${totalSegments} (flag-evals: ${feSegments}, metric-events: ${meSegments})`, "expected > 0 after ingestion");
}

async function testQueryBinary() {
  console.log("\n🔍 Test 7: Query experiment (binary metric)");
  const now = new Date();
  const startOfDay = new Date(now);
  startOfDay.setUTCHours(0, 0, 0, 0);
  const endOfDay = new Date(now);
  endOfDay.setUTCHours(23, 59, 59, 999);

  const req = {
    envId: ENV_SECRET,
    flagKey: FLAG_KEY,
    metricEvent: EVENT_NAME,
    metricType: "binary",
    metricAgg: "once",
    controlVariant: "control",
    treatmentVariant: "treatment",
    start: startOfDay.toISOString(),
    end: endOfDay.toISOString(),
    experimentId: EXPERIMENT_ID,
  };

  const res = await post("/api/query/experiment", req);
  assert(res.status === 200, `POST /api/query/experiment → ${res.status}`, "expected 200");

  const body = await res.json() as {
    metricType: string;
    variants: Record<string, { n: number; k?: number }>;
  };
  console.log(`   Response: ${JSON.stringify(body, null, 2)}`);

  assert(body.metricType === "binary", `metricType = "${body.metricType}"`, 'expected "binary"');

  const control = body.variants?.control;
  const treatment = body.variants?.treatment;

  assert(control != null, "control variant present in response");
  assert(treatment != null, "treatment variant present in response");

  if (control && treatment) {
    assert(control.n > 0, `control.n = ${control.n}`, "expected > 0");
    assert(treatment.n > 0, `treatment.n = ${treatment.n}`, "expected > 0");
    assert(typeof control.k === "number", `control.k = ${control.k}`, "expected number");
    assert(typeof treatment.k === "number", `treatment.k = ${treatment.k}`, "expected number");

    // Sanity: k ≤ n
    assert(control.k! <= control.n, `control.k (${control.k}) ≤ control.n (${control.n})`);
    assert(treatment.k! <= treatment.n, `treatment.k (${treatment.k}) ≤ treatment.n (${treatment.n})`);

    // Total users ≥ 51 (1 single + 50 batch; may include data from prior runs)
    const totalN = control.n + treatment.n;
    assert(totalN >= 51, `total n = ${totalN}`, "expected ≥ 51");

    // Conversion rates should roughly match: control ~30%, treatment ~50%
    const controlRate = control.k! / control.n;
    const treatmentRate = treatment.k! / treatment.n;
    console.log(`   Control conversion:   ${(controlRate * 100).toFixed(1)}% (${control.k}/${control.n})`);
    console.log(`   Treatment conversion: ${(treatmentRate * 100).toFixed(1)}% (${treatment.k}/${treatment.n})`);
  }
}

async function testQueryContinuous() {
  console.log("\n🔍 Test 8: Query experiment (continuous metric — revenue sum)");
  const now = new Date();
  const startOfDay = new Date(now);
  startOfDay.setUTCHours(0, 0, 0, 0);
  const endOfDay = new Date(now);
  endOfDay.setUTCHours(23, 59, 59, 999);

  const req = {
    envId: ENV_SECRET,
    flagKey: FLAG_KEY,
    metricEvent: EVENT_NAME,
    metricType: "continuous",
    metricAgg: "sum",
    controlVariant: "control",
    treatmentVariant: "treatment",
    start: startOfDay.toISOString(),
    end: endOfDay.toISOString(),
    experimentId: EXPERIMENT_ID,
  };

  const res = await post("/api/query/experiment", req);
  assert(res.status === 200, `POST /api/query/experiment (continuous) → ${res.status}`, "expected 200");

  const body = await res.json() as {
    metricType: string;
    variants: Record<string, { n: number; mean?: number; total?: number; variance?: number }>;
  };
  console.log(`   Response: ${JSON.stringify(body, null, 2)}`);

  assert(body.metricType === "continuous", `metricType = "${body.metricType}"`);

  const control = body.variants?.control;
  const treatment = body.variants?.treatment;

  if (control && treatment) {
    assert(typeof control.mean === "number", `control.mean = ${control.mean}`);
    assert(typeof treatment.mean === "number", `treatment.mean = ${treatment.mean}`);
    assert(typeof control.total === "number", `control.total = ${control.total}`);
    assert(typeof treatment.total === "number", `treatment.total = ${treatment.total}`);
  }
}

async function testNotFound() {
  console.log("\n🔍 Test 9: Unknown route (expect 404)");
  const res = await get("/api/nonexistent");
  assert(res.status === 404, `GET /api/nonexistent → ${res.status}`, "expected 404");
}

// ── Runner ───────────────────────────────────────────────────────────────────

async function main() {
  console.log(`\n${"═".repeat(60)}`);
  console.log(`  FeatBit TSDB Cloudflare — E2E Test Suite`);
  console.log(`  Target: ${BASE_URL}`);
  console.log(`  Time:   ${new Date().toISOString()}`);
  console.log(`${"═".repeat(60)}`);

  // Phase 1: Basic connectivity
  await testHealthCheck();

  // Phase 2: Ingestion
  await testTrackSingleUser();
  await testTrackBatch();
  await testTrackNoAuth();
  await testTrackEmptyBody();

  // Phase 3: Wait for DO alarm flush (Durable Objects flush on 500ms alarm)
  console.log("\n⏳ Waiting 3s for Durable Object alarm flush...");
  await new Promise((r) => setTimeout(r, 3000));

  // Phase 4: Verify ingestion
  await testStatsAfterIngest();

  // Phase 5: Query
  await testQueryBinary();
  await testQueryContinuous();

  // Phase 6: Edge cases
  await testNotFound();

  // Summary
  console.log(`\n${"═".repeat(60)}`);
  console.log(`  Results: ${passed} passed, ${failed} failed, ${passed + failed} total`);
  console.log(`${"═".repeat(60)}\n`);

  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(2);
});
