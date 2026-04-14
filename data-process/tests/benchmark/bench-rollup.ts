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
    },
    timeout: 300_000,
  });
  const elapsed = performance.now() - start;

  if (result.status !== 0) {
    const stderr = result.stderr?.toString() ?? "";
    throw new Error(`rollup-service failed (${result.status}): ${stderr.slice(0, 500)}`);
  }

  return elapsed;
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
  console.log(`${"Users".padStart(10)}  ${"Delta Upload".padStart(14)}  ${"Rollup Time".padStart(12)}`);
  console.log("-".repeat(42));

  for (const userCount of USER_COUNTS) {
    process.stdout.write(`${userCount.toLocaleString().padStart(10)}  `);

    // Upload deltas
    const uploadStart = performance.now();
    const writtenKeys = await uploadDeltas(userCount, envId, flagKey, metric, today);
    const uploadMs    = performance.now() - uploadStart;
    process.stdout.write(`${(uploadMs / 1000).toFixed(2)}s upload    `);

    // Run rollup
    let rollupMs: number;
    try {
      rollupMs = runRollupOnce();
    } finally {
      // Always clean up, even on failure
      await cleanupKeys(writtenKeys);
      await cleanupRollups(envId, flagKey, metric, today);
    }

    console.log(`${(rollupMs / 1000).toFixed(2)}s`);
  }

  console.log("\nBenchmark complete.");
}

main().catch(err => {
  console.error("Benchmark failed:", err);
  process.exit(1);
});
