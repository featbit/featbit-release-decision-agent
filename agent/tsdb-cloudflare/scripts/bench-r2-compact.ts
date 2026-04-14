#!/usr/bin/env npx tsx
/**
 * Compaction benchmark against real R2 data.
 *
 * Runs compact() locally but reads/writes from the actual R2 bucket.
 * Measures:
 *   - R2 LIST latency (discovering segment keys)
 *   - R2 GET latency per segment (real network round-trips)
 *   - Local CPU time for decompression + aggregation
 *   - R2 PUT latency for writing the rollup
 *
 * Required env vars (same as seed-r2.ts):
 *   R2_ACCOUNT_ID
 *   R2_ACCESS_KEY_ID
 *   R2_SECRET_ACCESS_KEY
 *
 * Usage:
 *   npx tsx scripts/bench-r2-compact.ts
 */

import { createHmac, createHash } from "node:crypto";
import { compact } from "../src/rollup/compact";

// ── Config — must match what seed-r2.ts wrote ─────────────────────────────────

const BUCKET       = "featbit-tsdb";
const ENV_ID       = "c93f1a2b-3d4e-5f6a-7b8c-9d0e1f2a3b4c";
const FLAG_KEY     = "pricing-redesign-2026";
const METRIC_EVENT = "checkout_completed";
const DATE         = "2026-04-13";

// ── AWS SigV4 (shared with seed-r2.ts) ───────────────────────────────────────

function sha256hex(data: string | Buffer): string {
  return createHash("sha256").update(data).digest("hex");
}

function hmac256(key: string | Buffer, data: string): Buffer {
  return createHmac("sha256", key).update(data).digest();
}

function getSigningKey(secret: string, date: string, region: string, service: string): Buffer {
  return hmac256(hmac256(hmac256(hmac256("AWS4" + secret, date), region), service), "aws4_request");
}

function authHeader(opts: {
  method: string; path: string; host: string;
  dateTime: string; date: string; contentHash: string;
  accessKeyId: string; secretKey: string;
}): string {
  const sh = "content-type;host;x-amz-content-sha256;x-amz-date";
  const cr = [
    opts.method, opts.path, "",
    `content-type:application/octet-stream\nhost:${opts.host}\nx-amz-content-sha256:${opts.contentHash}\nx-amz-date:${opts.dateTime}\n`,
    sh, opts.contentHash,
  ].join("\n");
  const scope = `${opts.date}/auto/s3/aws4_request`;
  const sts   = ["AWS4-HMAC-SHA256", opts.dateTime, scope, sha256hex(cr)].join("\n");
  const sig   = hmac256(getSigningKey(opts.secretKey, opts.date, "auto", "s3"), sts).toString("hex");
  return `AWS4-HMAC-SHA256 Credential=${opts.accessKeyId}/${scope}, SignedHeaders=${sh}, Signature=${sig}`;
}

// ── Real R2 client implementing the R2Bucket interface ────────────────────────

interface Creds { accountId: string; accessKeyId: string; secretKey: string }

function nowParts() {
  const now      = new Date();
  const dateTime = now.toISOString().replace(/[-:]|\.\d{3}/g, "").slice(0, 15) + "Z";
  return { dateTime, date: dateTime.slice(0, 8) };
}

class RealR2Bucket {
  private readonly host: string;
  private readonly baseUrl: string;

  constructor(private readonly creds: Creds, private readonly bucket: string) {
    this.host    = `${creds.accountId}.r2.cloudflarestorage.com`;
    this.baseUrl = `https://${this.host}/${bucket}`;
  }

  private encodedPath(key: string): string {
    return key.split("/").map(encodeURIComponent).join("/");
  }

  private headers(method: string, path: string, body: Buffer, { dateTime, date } = nowParts()) {
    const contentHash = sha256hex(body);
    return {
      "content-type":         "application/octet-stream",
      "x-amz-date":           dateTime,
      "x-amz-content-sha256": contentHash,
      "authorization": authHeader({
        method, path, host: this.host,
        dateTime, date, contentHash,
        accessKeyId: this.creds.accessKeyId,
        secretKey:   this.creds.secretKey,
      }),
    };
  }

  // ── R2Bucket interface ──────────────────────────────────────────────────────

  async get(key: string, retries = 4): Promise<{ arrayBuffer(): Promise<ArrayBuffer>; json<T>(): Promise<T> } | null> {
    const path = `/${this.bucket}/${this.encodedPath(key)}`;
    for (let attempt = 0; attempt <= retries; attempt++) {
      if (attempt > 0) await new Promise(r => setTimeout(r, 100 * attempt));
      try {
        const res = await fetch(`https://${this.host}${path}`, {
          method:  "GET",
          headers: this.headers("GET", path, Buffer.alloc(0)),
        });
        if (res.status === 404) return null;
        if (!res.ok) throw new Error(`R2 GET ${key}: HTTP ${res.status}`);
        const buf = await res.arrayBuffer();
        return {
          arrayBuffer: () => Promise.resolve(buf),
          json:        <T>() => Promise.resolve(JSON.parse(new TextDecoder().decode(buf))) as Promise<T>,
        };
      } catch (err) {
        const isSocket = (err as NodeJS.ErrnoException).code === "UND_ERR_SOCKET";
        if (attempt < retries && isSocket) continue;
        throw err;
      }
    }
    throw new Error(`R2 GET ${key}: exhausted retries`);
  }

  async head(key: string): Promise<object | null> {
    const path = `/${this.bucket}/${this.encodedPath(key)}`;
    const res  = await fetch(`https://${this.host}${path}`, {
      method:  "HEAD",
      headers: this.headers("HEAD", path, Buffer.alloc(0)),
    });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`R2 HEAD ${key}: HTTP ${res.status}`);
    return { key };
  }

  async put(key: string, value: ArrayBuffer | string): Promise<void> {
    const data = typeof value === "string"
      ? Buffer.from(value, "utf8")
      : Buffer.from(value);
    const path = `/${this.bucket}/${this.encodedPath(key)}`;
    const res  = await fetch(`https://${this.host}${path}`, {
      method:  "PUT",
      headers: this.headers("PUT", path, data),
      body:    data,
    });
    if (!res.ok) throw new Error(`R2 PUT ${key}: HTTP ${res.status}`);
  }

  async list(opts?: { prefix?: string; cursor?: string; delimiter?: string }): Promise<{
    objects: { key: string }[];
    truncated: boolean;
    cursor: string | undefined;
    delimitedPrefixes: string[];
  }> {
    // SigV4 requires query params sorted alphabetically
    const raw: [string, string][] = [["list-type", "2"]];
    if (opts?.prefix)    raw.push(["prefix",             opts.prefix]);
    if (opts?.delimiter) raw.push(["delimiter",          opts.delimiter]);
    if (opts?.cursor)    raw.push(["continuation-token", opts.cursor]);
    raw.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
    const qs = raw.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join("&");

    const path = `/${this.bucket}`;
    const { dateTime, date } = nowParts();
    const contentHash = sha256hex(Buffer.alloc(0));

    // For LIST we sign with empty content and no content-type
    const sh = "host;x-amz-content-sha256;x-amz-date";
    const cr = [
      "GET", path, qs,
      `host:${this.host}\nx-amz-content-sha256:${contentHash}\nx-amz-date:${dateTime}\n`,
      sh, contentHash,
    ].join("\n");
    const scope = `${date}/auto/s3/aws4_request`;
    const sts   = ["AWS4-HMAC-SHA256", dateTime, scope, sha256hex(cr)].join("\n");
    const sig   = hmac256(getSigningKey(this.creds.secretKey, date, "auto", "s3"), sts).toString("hex");
    const auth  = `AWS4-HMAC-SHA256 Credential=${this.creds.accessKeyId}/${scope}, SignedHeaders=${sh}, Signature=${sig}`;

    const res = await fetch(`https://${this.host}${path}?${qs}`, {
      headers: {
        "host":                  this.host,
        "x-amz-date":            dateTime,
        "x-amz-content-sha256":  contentHash,
        "authorization":         auth,
      },
    });

    if (!res.ok) throw new Error(`R2 LIST prefix=${opts?.prefix}: HTTP ${res.status} ${await res.text()}`);

    const xml = await res.text();

    // Parse keys from S3 XML response
    const objects: { key: string }[] = [];
    const delimitedPrefixes: string[] = [];

    for (const m of xml.matchAll(/<Key>([^<]+)<\/Key>/g)) {
      objects.push({ key: decodeURIComponent(m[1]) });
    }
    for (const m of xml.matchAll(/<Prefix>([^<]+)<\/Prefix>/g)) {
      const p = decodeURIComponent(m[1]);
      if (p !== (opts?.prefix ?? "")) delimitedPrefixes.push(p);
    }

    const truncated   = /<IsTruncated>true<\/IsTruncated>/.test(xml);
    const cursorMatch = xml.match(/<NextContinuationToken>([^<]+)<\/NextContinuationToken>/);
    const cursor      = truncated ? (cursorMatch?.[1] ?? undefined) : undefined;

    return { objects, truncated, cursor, delimitedPrefixes };
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtMs(ms: number): string {
  return ms < 1000 ? `${ms.toFixed(0)}ms` : `${(ms / 1000).toFixed(2)}s`;
}

function hr()  { console.log("─".repeat(64)); }
function banner(title: string) {
  console.log("═".repeat(64));
  console.log(`  ${title}`);
  console.log("═".repeat(64));
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const creds: Creds = {
    accountId:   process.env.R2_ACCOUNT_ID        ?? "",
    accessKeyId: process.env.R2_ACCESS_KEY_ID     ?? "",
    secretKey:   process.env.R2_SECRET_ACCESS_KEY ?? "",
  };

  if (!creds.accountId || !creds.accessKeyId || !creds.secretKey) {
    console.error("Missing env vars: R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY");
    process.exit(1);
  }

  banner("FeatBit TSDB — Compaction Benchmark (real R2)");
  console.log(`  bucket:       ${BUCKET}`);
  console.log(`  envId:        ${ENV_ID}`);
  console.log(`  flagKey:      ${FLAG_KEY}`);
  console.log(`  metricEvent:  ${METRIC_EVENT}`);
  console.log(`  date:         ${DATE}`);
  console.log();

  const bucket = new RealR2Bucket(creds, BUCKET);

  // ── Step 1: count segments ─────────────────────────────────────────────────

  console.log("Step 1 — Listing segments in R2");
  hr();

  const t0List = Date.now();

  const fePrefix = `flag-evals/${ENV_ID}/${FLAG_KEY}/${DATE}/`;
  const mePrefix = `metric-events/${ENV_ID}/${METRIC_EVENT}/${DATE}/`;

  let feKeys: string[] = [];
  let meKeys: string[] = [];
  let cursor: string | undefined;

  do {
    const res = await bucket.list({ prefix: fePrefix, cursor });
    feKeys.push(...res.objects.map(o => o.key));
    cursor = res.cursor;
  } while (cursor);

  cursor = undefined;
  do {
    const res = await bucket.list({ prefix: mePrefix, cursor });
    meKeys.push(...res.objects.map(o => o.key));
    cursor = res.cursor;
  } while (cursor);

  const listMs = Date.now() - t0List;

  console.log(`  flag-eval segments:    ${feKeys.length}`);
  console.log(`  metric-event segments: ${meKeys.length}`);
  console.log(`  LIST time: ${fmtMs(listMs)}`);
  console.log();

  if (feKeys.length === 0) {
    console.error("  No segments found. Run seed-r2.ts first.");
    process.exit(1);
  }

  // ── Step 2: compact ────────────────────────────────────────────────────────

  console.log("Step 2 — Running compact() against real R2");
  hr();
  console.log("  Reading all segments from R2, decompressing, aggregating...");
  console.log("  (this measures real R2 GET latency + local CPU)\n");

  const t0Compact = Date.now();

  const result = await compact(bucket as unknown as R2Bucket, {
    envId:        ENV_ID,
    flagKey:      FLAG_KEY,
    metricEvents: [METRIC_EVENT],
    startDate:    DATE,
    endDate:      DATE,
    force:        true,   // overwrite existing rollup if any
  });

  const compactMs = Date.now() - t0Compact;

  console.log(`  flag-eval   rollup: created=${result.flagEval.created}   skipped=${result.flagEval.skipped}`);
  console.log(`  metric-event rollup: created=${result.metricEvent.created}  skipped=${result.metricEvent.skipped}`);
  console.log();

  // ── Summary ────────────────────────────────────────────────────────────────

  banner("Results");

  const totalSegs = feKeys.length + meKeys.length;

  console.log(`  LIST time:            ${fmtMs(listMs)}`);
  console.log(`  Compact total:        ${fmtMs(compactMs)}`);
  console.log(`    compact internal:   ${fmtMs(result.durationMs)}`);
  console.log();
  console.log(`  Total segments read:  ${totalSegs} (FE: ${feKeys.length}, ME: ${meKeys.length})`);
  console.log(`  Avg time/segment:     ${fmtMs(compactMs / totalSegs)}`);
  console.log(`  Throughput:           ${(totalSegs / (compactMs / 1000)).toFixed(1)} segs/s`);
  console.log();

  // Cloudflare Worker 限制评估
  const CF_LIMIT_MS = 30_000;
  const headroom    = CF_LIMIT_MS - compactMs;
  console.log(`  Cloudflare Worker CPU limit: 30s`);
  console.log(`  This run took:               ${fmtMs(compactMs)}`);
  if (headroom > 0) {
    console.log(`  Headroom:                    +${fmtMs(headroom)} ✅`);
  } else {
    console.log(`  ⚠️  OVER CF LIMIT by ${fmtMs(Math.abs(headroom))} — Worker would time out!`);
  }
  console.log();
  console.log("  Note: local CPU is faster than CF Worker (V8 isolate has lower CPU quota).");
  console.log("        CF Worker real time ≈ this result × 2-5x.");
  console.log();

  process.exit(0);
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
