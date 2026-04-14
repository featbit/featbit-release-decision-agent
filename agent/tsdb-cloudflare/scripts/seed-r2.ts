#!/usr/bin/env npx tsx
/**
 * Seed R2 with simulated experiment data for compaction benchmarking.
 *
 * Uses R2's S3-compatible API directly with AWS SigV4 signing — no wrangler
 * subprocess per object, so bulk uploads are fast and stable.
 *
 * Required env vars:
 *   R2_ACCOUNT_ID        — Cloudflare account ID (32-char hex)
 *   R2_ACCESS_KEY_ID     — R2 API token access key
 *   R2_SECRET_ACCESS_KEY — R2 API token secret key
 *
 * Create R2 API tokens at:
 *   Cloudflare Dashboard → R2 → Manage R2 API Tokens → Create API token
 *   Permission: Object Read & Write on bucket "featbit-tsdb"
 *
 * Usage:
 *   R2_ACCOUNT_ID=xxx R2_ACCESS_KEY_ID=xxx R2_SECRET_ACCESS_KEY=xxx \
 *     npx tsx scripts/seed-r2.ts
 *
 *   npx tsx scripts/seed-r2.ts --dry-run   # generate only, no upload
 */

import { createHmac, createHash } from "node:crypto";
import { writeFlagEvalSegment, writeMetricEventSegment } from "../src/storage/segment-writer";
import { computeHashBucket } from "../src/models/flag-eval-record";
import { flagEvalPrefix, metricEventPrefix } from "../src/storage/path-helper";
import type { FlagEvalRecord } from "../src/models/flag-eval-record";
import type { MetricEventRecord } from "../src/models/metric-event-record";

// ── Config ────────────────────────────────────────────────────────────────────

const BUCKET              = "featbit-tsdb";
const EXPERIMENT_ID       = "b47e3e12-9f2a-4c1b-8d3e-2a1f5c6b7d8e";
const ENV_ID              = "c93f1a2b-3d4e-5f6a-7b8c-9d0e1f2a3b4c";
const FLAG_KEY            = "pricing-redesign-2026";
const METRIC_EVENT        = "checkout_completed";
const DATE                = "2026-04-13";

const SEGMENTS_PER_TABLE  = 2_000;
const RECORDS_PER_SEGMENT = 5_000;
const UNIQUE_USERS        = 20_000;

/** Concurrent HTTP PUTs to R2. 32 works well; R2 doesn't rate-limit normal PUT traffic. */
const UPLOAD_CONCURRENCY  = 32;

/** Retry up to N times on transient errors (5xx, network). */
const MAX_RETRIES         = 4;

const VARIANTS = ["control", "treatment"] as const;
const DRY_RUN  = process.argv.includes("--dry-run");

// ── AWS SigV4 signing (for R2 S3-compatible API) ──────────────────────────────

function sha256hex(data: string | Buffer): string {
  return createHash("sha256").update(data).digest("hex");
}

function hmac256(key: string | Buffer, data: string): Buffer {
  return createHmac("sha256", key).update(data).digest();
}

function getSigningKey(secret: string, date: string, region: string, service: string): Buffer {
  const kDate    = hmac256("AWS4" + secret, date);
  const kRegion  = hmac256(kDate, region);
  const kService = hmac256(kRegion, service);
  return hmac256(kService, "aws4_request");
}

function buildAuthHeader(opts: {
  method:      string;
  path:        string;          // e.g. /bucket/key
  host:        string;
  dateTime:    string;          // e.g. "20260413T120000Z"
  date:        string;          // e.g. "20260413"
  contentHash: string;
  accessKeyId: string;
  secretKey:   string;
  region:      string;
  service:     string;
}): string {
  const signedHeaders = "content-type;host;x-amz-content-sha256;x-amz-date";

  const canonicalRequest = [
    opts.method,
    opts.path,
    "",   // no query string
    `content-type:application/octet-stream\nhost:${opts.host}\nx-amz-content-sha256:${opts.contentHash}\nx-amz-date:${opts.dateTime}\n`,
    signedHeaders,
    opts.contentHash,
  ].join("\n");

  const credentialScope = `${opts.date}/${opts.region}/${opts.service}/aws4_request`;
  const stringToSign    = [
    "AWS4-HMAC-SHA256",
    opts.dateTime,
    credentialScope,
    sha256hex(canonicalRequest),
  ].join("\n");

  const signingKey  = getSigningKey(opts.secretKey, opts.date, opts.region, opts.service);
  const signature   = hmac256(signingKey, stringToSign).toString("hex");

  return `AWS4-HMAC-SHA256 Credential=${opts.accessKeyId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
}

// ── R2 upload ─────────────────────────────────────────────────────────────────

interface R2Creds {
  accountId:    string;
  accessKeyId:  string;
  secretKey:    string;
}

async function putR2Object(
  creds: R2Creds,
  bucket: string,
  key: string,
  data: Buffer,
  retries = MAX_RETRIES,
): Promise<void> {
  const host    = `${creds.accountId}.r2.cloudflarestorage.com`;
  const path    = `/${bucket}/${key.split("/").map(encodeURIComponent).join("/")}`;
  const url     = `https://${host}${path}`;

  const now      = new Date();
  const dateTime = now.toISOString().replace(/[-:]|\.\d{3}/g, "").slice(0, 15) + "Z";
  const date     = dateTime.slice(0, 8);

  const contentHash = sha256hex(data);
  const auth        = buildAuthHeader({
    method: "PUT", path, host,
    dateTime, date, contentHash,
    accessKeyId: creds.accessKeyId,
    secretKey:   creds.secretKey,
    region:      "auto",
    service:     "s3",
  });

  for (let attempt = 0; attempt <= retries; attempt++) {
    if (attempt > 0) {
      await sleep(200 * 2 ** attempt);   // 400ms, 800ms, 1600ms, 3200ms
    }

    let res: Response;
    try {
      res = await fetch(url, {
        method: "PUT",
        headers: {
          "content-type":           "application/octet-stream",
          "x-amz-date":             dateTime,
          "x-amz-content-sha256":   contentHash,
          "authorization":          auth,
        },
        body: data,
      });
    } catch (err) {
      if (attempt < retries) continue;
      throw new Error(`Network error on ${key}: ${(err as Error).message}`);
    }

    if (res.ok) return;

    const body = await res.text().catch(() => "");
    if (attempt < retries && res.status >= 500) continue;
    throw new Error(`R2 PUT failed for ${key}: HTTP ${res.status} — ${body.slice(0, 200)}`);
  }
}

// ── Data generators ───────────────────────────────────────────────────────────

function pickUsers(pool: string[], count: number): string[] {
  const result = new Array<string>(count);
  for (let i = 0; i < count; i++) {
    result[i] = pool[(Math.random() * pool.length) | 0];
  }
  return result;
}

function makeFlagEvalRecords(
  userPool: string[],
  count: number,
  baseTs: number,
): FlagEvalRecord[] {
  const users   = pickUsers(userPool, count);
  const records = new Array<FlagEvalRecord>(count);
  for (let i = 0; i < count; i++) {
    const userKey = users[i];
    const variant = VARIANTS[(Math.random() * 2) | 0];
    records[i] = {
      envId:         ENV_ID,
      flagKey:       FLAG_KEY,
      userKey,
      variant,
      experimentId:  EXPERIMENT_ID,
      layerId:       null,
      sessionId:     null,
      timestamp:     baseTs + i * 17,
      hashBucket:    computeHashBucket(userKey, FLAG_KEY),
      userPropsJson: null,
    };
  }
  return records;
}

function makeMetricEventRecords(
  userPool: string[],
  count: number,
  baseTs: number,
): MetricEventRecord[] {
  const users   = pickUsers(userPool, count);
  const records = new Array<MetricEventRecord>(count);
  for (let i = 0; i < count; i++) {
    records[i] = {
      envId:        ENV_ID,
      eventName:    METRIC_EVENT,
      userKey:      users[i],
      numericValue: Math.round((10 + Math.random() * 190) * 100) / 100,
      timestamp:    baseTs + i * 17 + 30_000,
      sessionId:    null,
      source:       null,
    };
  }
  return records;
}

// ── Concurrency limiter ───────────────────────────────────────────────────────

async function runWithConcurrency<T>(
  tasks: (() => Promise<T>)[],
  concurrency: number,
): Promise<T[]> {
  const results: T[] = new Array(tasks.length);
  let next = 0;

  async function worker() {
    while (next < tasks.length) {
      const idx = next++;
      results[idx] = await tasks[idx]();
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(concurrency, tasks.length) }, worker),
  );
  return results;
}

function sleep(ms: number) { return new Promise((r) => setTimeout(r, ms)); }

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtMs(ms: number): string {
  return ms < 1000 ? `${ms.toFixed(0)}ms` : `${(ms / 1000).toFixed(2)}s`;
}

function fmtBytes(bytes: number): string {
  if (bytes < 1_048_576) return `${(bytes / 1_024).toFixed(1)}KB`;
  return `${(bytes / 1_048_576).toFixed(2)}MB`;
}

function hr()  { console.log("─".repeat(64)); }
function banner(title: string) {
  console.log("═".repeat(64));
  console.log(`  ${title}`);
  console.log("═".repeat(64));
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  banner("FeatBit TSDB — R2 Data Seeder");
  if (DRY_RUN) console.log("  *** DRY RUN — no uploads will happen ***\n");

  // Validate credentials (unless dry-run)
  const creds: R2Creds = {
    accountId:   process.env.R2_ACCOUNT_ID   ?? "",
    accessKeyId: process.env.R2_ACCESS_KEY_ID ?? "",
    secretKey:   process.env.R2_SECRET_ACCESS_KEY ?? "",
  };

  if (!DRY_RUN) {
    const missing = (["accountId", "accessKeyId", "secretKey"] as const)
      .filter((k) => !creds[k]);
    if (missing.length > 0) {
      console.error("Missing env vars:");
      console.error("  R2_ACCOUNT_ID        — Cloudflare account ID");
      console.error("  R2_ACCESS_KEY_ID     — R2 API token access key");
      console.error("  R2_SECRET_ACCESS_KEY — R2 API token secret key");
      console.error("\nCreate tokens at: Cloudflare Dashboard → R2 → Manage R2 API Tokens");
      process.exit(1);
    }
  }

  console.log(`  bucket:           ${BUCKET}`);
  console.log(`  experimentId:     ${EXPERIMENT_ID}`);
  console.log(`  envId:            ${ENV_ID}`);
  console.log(`  flagKey:          ${FLAG_KEY}`);
  console.log(`  metricEvent:      ${METRIC_EVENT}`);
  console.log(`  date:             ${DATE}`);
  console.log();
  console.log(`  Segments/table:   ${SEGMENTS_PER_TABLE.toLocaleString()}`);
  console.log(`  Records/segment:  ${RECORDS_PER_SEGMENT.toLocaleString()}`);
  console.log(`  Total records:    ${(SEGMENTS_PER_TABLE * RECORDS_PER_SEGMENT * 2).toLocaleString()}`);
  console.log(`  Upload concurrency: ${UPLOAD_CONCURRENCY}`);
  console.log();

  const userPool = Array.from({ length: UNIQUE_USERS }, (_, i) => `user-${String(i).padStart(6, "0")}`);
  const dayStart = new Date(`${DATE}T00:00:00Z`).getTime();
  const msPerSeg = Math.floor(86_400_000 / SEGMENTS_PER_TABLE);

  const fePrefix = flagEvalPrefix(ENV_ID, FLAG_KEY, DATE);
  const mePrefix = metricEventPrefix(ENV_ID, METRIC_EVENT, DATE);

  // ── Step 1: Generate all segments ──────────────────────────────────────────

  console.log("Step 1 — Generating segments in-memory");
  hr();

  type Job = { key: string; data: Buffer };
  const jobs: Job[] = [];
  let genMs = 0;
  let totalBytes = 0;

  for (let s = 0; s < SEGMENTS_PER_TABLE; s++) {
    const baseTs = dayStart + s * msPerSeg;
    const seqStr = String(s + 1).padStart(8, "0");
    const t0     = Date.now();

    const feRecs   = makeFlagEvalRecords(userPool, RECORDS_PER_SEGMENT, baseTs);
    const feResult = await writeFlagEvalSegment(feRecs);
    const feData   = Buffer.from(feResult.data.buffer as ArrayBuffer);
    jobs.push({ key: `${fePrefix}seg-${seqStr}.fbs`, data: feData });
    totalBytes += feData.byteLength;

    const meRecs   = makeMetricEventRecords(userPool, RECORDS_PER_SEGMENT, baseTs);
    const meResult = await writeMetricEventSegment(meRecs);
    const meData   = Buffer.from(meResult.data.buffer as ArrayBuffer);
    jobs.push({ key: `${mePrefix}seg-${seqStr}.fbs`, data: meData });
    totalBytes += meData.byteLength;

    genMs += Date.now() - t0;

    if ((s + 1) % 200 === 0 || s === 0) {
      process.stdout.write(
        `  [${String(s + 1).padStart(4)}/${SEGMENTS_PER_TABLE}]` +
        `  objects=${jobs.length}  total=${fmtBytes(totalBytes)}\n`,
      );
    }
  }

  console.log(`\n  Generated ${jobs.length} segments (${fmtBytes(totalBytes)}) in ${fmtMs(genMs)}\n`);

  if (DRY_RUN) {
    console.log("  DRY RUN — skipping upload. Keys that would be written:");
    for (const job of jobs.slice(0, 4)) console.log(`    ${job.key}`);
    if (jobs.length > 4) console.log(`    ... and ${jobs.length - 4} more`);
    return;
  }

  // ── Step 2: Upload to R2 ───────────────────────────────────────────────────

  console.log("Step 2 — Uploading to R2 (S3-compatible API, direct HTTP PUT)");
  hr();
  console.log(`  Endpoint: https://${creds.accountId}.r2.cloudflarestorage.com/${BUCKET}/`);
  console.log(`  Uploading ${jobs.length} objects with concurrency ${UPLOAD_CONCURRENCY}...\n`);

  let uploaded = 0;
  let failed   = 0;
  const uploadStart = Date.now();

  const tasks = jobs.map((job) => async () => {
    try {
      await putR2Object(creds, BUCKET, job.key, job.data);
      uploaded++;
    } catch (err) {
      failed++;
      console.error(`  ✗ ${job.key.split("/").pop()}: ${(err as Error).message}`);
    }

    const done = uploaded + failed;
    if (done % 200 === 0 || done === jobs.length) {
      const elapsed = Date.now() - uploadStart;
      const rate    = done / (elapsed / 1000);
      const etaSec  = (jobs.length - done) / rate;
      process.stdout.write(
        `  [${String(done).padStart(4)}/${jobs.length}]` +
        `  ✓ ${uploaded}  ✗ ${failed}` +
        `  ${rate.toFixed(1)} obj/s` +
        (done < jobs.length ? `  ETA ~${fmtMs(etaSec * 1000)}` : "") +
        "\n",
      );
    }
  });

  await runWithConcurrency(tasks, UPLOAD_CONCURRENCY);

  const uploadMs = Date.now() - uploadStart;

  console.log();
  banner("Done");
  console.log(`  Objects generated:  ${jobs.length}`);
  console.log(`  Uploaded:           ${uploaded} ✓`);
  if (failed > 0) console.log(`  Failed:             ${failed} ✗`);
  console.log(`  Total data:         ${fmtBytes(totalBytes)}`);
  console.log(`  Upload time:        ${fmtMs(uploadMs)}`);
  console.log(`  Avg throughput:     ${(uploaded / (uploadMs / 1000)).toFixed(1)} obj/s`);
  console.log();
  console.log("  R2 paths:");
  console.log(`    ${fePrefix}seg-00000001.fbs … seg-${String(SEGMENTS_PER_TABLE).padStart(8, "0")}.fbs`);
  console.log(`    ${mePrefix}seg-00000001.fbs … seg-${String(SEGMENTS_PER_TABLE).padStart(8, "0")}.fbs`);
  console.log();

  if (failed > 0) {
    console.log("  ⚠️  Some uploads failed. Re-run — already-uploaded objects are safely overwritten.");
    process.exit(1);
  }

  process.exit(0);
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
