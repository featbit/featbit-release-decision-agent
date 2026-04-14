/**
 * bench-rollup.ts — measure rollup-service throughput at multiple scales
 *
 * For each scale (userCounts), it:
 *   1. Writes N synthetic delta files directly to R2 via S3 API
 *   2. Spawns rollup-service --run-once and measures wall-clock time
 *   3. Cleans up the written keys
 *
 * Run:
 *   cd data-process/tests/benchmark
 *   npm install
 *   R2_ACCOUNT_ID=... R2_ACCESS_KEY_ID=... R2_SECRET_ACCESS_KEY=... npx tsx bench-rollup.ts
 */

import { S3Client, PutObjectCommand, DeleteObjectsCommand, ListObjectsV2Command } from "@aws-sdk/client-s3";
import { spawnSync } from "child_process";
import path          from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ── Config ────────────────────────────────────────────────────────────────────

const ACCOUNT_ID  = process.env.R2_ACCOUNT_ID        ?? "";
const ACCESS_KEY  = process.env.R2_ACCESS_KEY_ID     ?? "";
const SECRET_KEY  = process.env.R2_SECRET_ACCESS_KEY ?? "";
const BUCKET      = "featbit-tsdb";
const ROLLUP_DIR  = path.resolve(__dirname, "../../rollup-service");

const USER_COUNTS = [1_000, 10_000, 100_000];  // scales to benchmark

// ── R2 client ─────────────────────────────────────────────────────────────────

const s3 = new S3Client({
  region:   "auto",
  endpoint: `https://${ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: { accessKeyId: ACCESS_KEY, secretAccessKey: SECRET_KEY },
  forcePathStyle: true,
});

// ── Data generation ───────────────────────────────────────────────────────────

function makeFlagEvalDelta(userCount: number, envId: string, flagKey: string, date: string): string {
  const u: Record<string, [number, string, string | null, string | null, number]> = {};
  const now = Date.now();
  for (let i = 0; i < userCount; i++) {
    const userKey = `bench-user-${i.toString().padStart(8, "0")}`;
    const variant = i % 2 === 0 ? "off" : "on";
    u[userKey] = [now - i, variant, "exp-bench", null, i % 100];
  }
  return JSON.stringify({ v: 1, u });
}

function makeMetricEventDelta(userCount: number, envId: string, eventName: string, date: string): string {
  const u: Record<string, [number, number, null, number, null, number, number]> = {};
  const now = Date.now();
  for (let i = 0; i < userCount; i++) {
    if (i % 3 === 0) {   // ~33% conversion
      const userKey = `bench-user-${i.toString().padStart(8, "0")}`;
      u[userKey] = [1, now - i, null, now - i, null, 0, 1];
    }
  }
  return JSON.stringify({ v: 1, u });
}

// ── Upload helpers ─────────────────────────────────────────────────────────────

async function uploadDeltas(
  userCount: number,
  envId:    string,
  flagKey:  string,
  metric:   string,
  date:     string,
): Promise<string[]> {
  const ts  = Date.now();
  const keys: string[] = [];

  const feKey = `deltas/flag-evals/${envId}/${flagKey}/${date}/${ts}.json`;
  const meKey = `deltas/metric-events/${envId}/${metric}/${date}/${ts}.json`;

  await s3.send(new PutObjectCommand({
    Bucket: BUCKET, Key: feKey,
    Body: makeFlagEvalDelta(userCount, envId, flagKey, date),
    ContentType: "application/json",
  }));
  keys.push(feKey);

  await s3.send(new PutObjectCommand({
    Bucket: BUCKET, Key: meKey,
    Body: makeMetricEventDelta(userCount, envId, metric, date),
    ContentType: "application/json",
  }));
  keys.push(meKey);

  return keys;
}

async function cleanupKeys(keys: string[]): Promise<void> {
  if (keys.length === 0) return;
  await s3.send(new DeleteObjectsCommand({
    Bucket: BUCKET,
    Delete: { Objects: keys.map(Key => ({ Key })) },
  }));
}

async function cleanupRollups(envId: string, flagKey: string, metric: string, date: string): Promise<void> {
  const prefixes = [
    `rollups/flag-evals/${envId}/${flagKey}/${date}.json`,
    `rollups/metric-events/${envId}/${metric}/${date}.json`,
  ];
  await cleanupKeys(prefixes);
}

// ── Rollup runner ─────────────────────────────────────────────────────────────

function runRollupOnce(): number {
  const start = performance.now();
  const result = spawnSync("dotnet", ["run", "--no-build", "--", "--run-once"], {
    cwd:     ROLLUP_DIR,
    stdio:   "pipe",
    env:     {
      ...process.env,
      R2_ACCOUNT_ID:        ACCOUNT_ID,
      R2_ACCESS_KEY_ID:     ACCESS_KEY,
      R2_SECRET_ACCESS_KEY: SECRET_KEY,
      Logging__LogLevel__Default: "Information",
    },
    timeout: 300_000,
  });
  const elapsed = performance.now() - start;

  // Print dotnet logs — strip the verbose "info: Category[0]" prefix
  const out = (result.stdout?.toString() ?? "") + (result.stderr?.toString() ?? "");
  if (out.trim()) {
    for (const raw of out.trim().split("\n")) {
      const line = raw.replace(/^\s*(info|dbug|warn|fail|crit):\s+[\w.]+\[\d+\]\s*/i, "").trimEnd();
      if (line) console.log("    " + line);
    }
  }

  if (result.status !== 0) {
    throw new Error(`rollup-service failed (${result.status})`);
  }

  return elapsed;
}

// ── Rollup JSON generators ─────────────────────────────────────────────────────

function makeFlagEvalRollup(userCount: number): string {
  const u: Record<string, [number, string, string | null, string | null, number]> = {};
  const now = Date.now();
  for (let i = 0; i < userCount; i++) {
    const userKey = `bench-user-${i.toString().padStart(8, "0")}`;
    const variant = i % 2 === 0 ? "off" : "on";
    u[userKey] = [now - i * 1000, variant, "exp-bench", null, i % 100];
  }
  return JSON.stringify({ v: 1, u });
}

function makeMetricEventRollup(userCount: number): string {
  // ~33% conversion, same shape as what rollup-service writes
  const u: Record<string, [number, number, null, number, null, number, number]> = {};
  const now = Date.now();
  for (let i = 0; i < userCount; i++) {
    if (i % 3 === 0) {
      const userKey = `bench-user-${i.toString().padStart(8, "0")}`;
      u[userKey] = [1, now - i * 1000, null, now - i * 1000, null, 0, 1];
    }
  }
  return JSON.stringify({ v: 1, u });
}

// ── Steady-state benchmark ─────────────────────────────────────────────────────
//
// Simulates a real production cycle with both tables:
//   flag-evals  : 150k-user rollup + 30k-user delta
//   metric-events: 50k-user rollup + 10k-user delta
//
// Rollup files are left in R2 after the run (no cleanup).

async function runSteadyStateBenchmark(
  envId: string, flagKey: string, metric: string, date: string,
): Promise<void> {
  const FE_ROLLUP = 150_000;
  const FE_DELTA  =  30_000;
  const ME_ROLLUP =  50_000;
  const ME_DELTA  =  10_000;

  const ts = Date.now();

  const feRollupKey = `rollups/flag-evals/${envId}/${flagKey}/${date}.json`;
  const feDeltaKey  = `deltas/flag-evals/${envId}/${flagKey}/${date}/${ts}.json`;
  const meRollupKey = `rollups/metric-events/${envId}/${metric}/${date}.json`;
  const meDeltaKey  = `deltas/metric-events/${envId}/${metric}/${date}/${ts}.json`;

  console.log("── Steady-state: flag-evals (150k+30k) + metric-events (50k+10k) ──");

  async function upload(label: string, key: string, body: string): Promise<void> {
    const mb = (Buffer.byteLength(body) / 1024 / 1024).toFixed(2);
    const t  = performance.now();
    await s3.send(new PutObjectCommand({ Bucket: BUCKET, Key: key, Body: body, ContentType: "application/json" }));
    console.log(`  ${label.padEnd(30)}: ${mb.padStart(6)} MB  upload ${((performance.now() - t) / 1000).toFixed(2)}s`);
  }

  await upload("flag-eval rollup (150k)",  feRollupKey, makeFlagEvalRollup(FE_ROLLUP));
  await upload("flag-eval delta  (30k)",   feDeltaKey,  makeFlagEvalDelta(FE_DELTA,  envId, flagKey, date));
  await upload("metric-event rollup (50k)", meRollupKey, makeMetricEventRollup(ME_ROLLUP));
  await upload("metric-event delta  (10k)", meDeltaKey,  makeMetricEventDelta(ME_DELTA, envId, metric, date));

  console.log("  running rollup-service --run-once...");
  const rollupMs = runRollupOnce();
  console.log(`  total (incl. dotnet startup ~2s): ${(rollupMs / 1000).toFixed(2)}s`);
  console.log(`  rollups left at:`);
  console.log(`    ${feRollupKey}`);
  console.log(`    ${meRollupKey}`);
  console.log();
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  if (!ACCOUNT_ID || !ACCESS_KEY || !SECRET_KEY) {
    console.error("R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY must be set.");
    process.exit(1);
  }

  const today   = new Date().toISOString().slice(0, 10);
  const envId   = "bench-env";
  const flagKey = "bench-flag";
  const metric  = "bench-metric";

  console.log("=== Rollup-Service Benchmark ===\n");

  // ── Scale sweep (fresh delta only, no pre-existing rollup) ──
  for (const userCount of USER_COUNTS) {
    console.log(`── ${userCount.toLocaleString()} users ──────────────────────────────`);

    // Upload deltas
    const uploadStart = performance.now();
    const writtenKeys = await uploadDeltas(userCount, envId, flagKey, metric, today);
    const uploadMs    = performance.now() - uploadStart;
    console.log(`  delta upload : ${(uploadMs / 1000).toFixed(2)}s`);

    // Run rollup
    let rollupMs: number;
    try {
      rollupMs = runRollupOnce();
    } finally {
      await cleanupKeys(writtenKeys);
      await cleanupRollups(envId, flagKey, metric, today);
    }

    console.log(`  total (incl. dotnet startup ~2s): ${(rollupMs / 1000).toFixed(2)}s`);
    console.log();
  }

  // ── Steady-state case: flag-evals (150k+30k) + metric-events (50k+10k) ──
  await runSteadyStateBenchmark(envId, flagKey, metric, today);

  console.log("\nBenchmark complete.");
}

main().catch(err => {
  console.error("Benchmark failed:", err);
  process.exit(1);
});
