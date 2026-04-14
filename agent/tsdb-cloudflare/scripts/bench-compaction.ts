#!/usr/bin/env npx tsx
/**
 * Compaction performance benchmark — runs entirely in-memory, no Cloudflare required.
 *
 * Simulates:
 *   200 flag-eval segments   × 5,000 records  =  1,000,000 flag-eval events
 *   200 metric-event segments × 5,000 records  =  1,000,000 metric-event events
 *
 * All data goes into a single (envId, flagKey, date) partition, forcing the
 * compactor to read every segment and merge them into one daily rollup.
 *
 * This reveals pure CPU + decompression cost, independent of R2 network latency.
 * In a real Cloudflare Worker, add ~20-80ms per R2 GET on top of these numbers.
 *
 * Usage:
 *   npx tsx scripts/bench-compaction.ts
 */

import { writeFlagEvalSegment } from "../src/storage/segment-writer";
import { writeMetricEventSegment } from "../src/storage/segment-writer";
import { compact } from "../src/rollup/compact";
import { computeHashBucket } from "../src/models/flag-eval-record";
import { flagEvalPrefix, metricEventPrefix } from "../src/storage/path-helper";
import type { FlagEvalRecord } from "../src/models/flag-eval-record";
import type { MetricEventRecord } from "../src/models/metric-event-record";

// ── Benchmark config ──────────────────────────────────────────────────────────

const EXPERIMENT_ID       = "b47e3e12-9f2a-4c1b-8d3e-2a1f5c6b7d8e";
const ENV_ID              = "c93f1a2b-3d4e-5f6a-7b8c-9d0e1f2a3b4c";
const FLAG_KEY            = "pricing-redesign-2026";
const METRIC_EVENT        = "checkout_completed";
const DATE                = "2026-04-13";   // yesterday — skips today guard without force

const SEGMENTS_PER_TABLE  = 200;
const RECORDS_PER_SEGMENT = 5_000;
const UNIQUE_USERS        = 20_000;         // pool; users repeat across segments

const VARIANTS = ["control", "treatment"] as const;

// ── In-memory R2 mock ─────────────────────────────────────────────────────────

type R2StoredValue = { data: ArrayBuffer };

class MemoryR2Bucket {
  private store = new Map<string, R2StoredValue>();
  private enc   = new TextEncoder();
  private dec   = new TextDecoder();

  async put(
    key: string,
    value: ArrayBuffer | string | ArrayBufferView,
    _options?: unknown,
  ): Promise<void> {
    let data: ArrayBuffer;
    if (typeof value === "string") {
      data = this.enc.encode(value).buffer as ArrayBuffer;
    } else if (value instanceof ArrayBuffer) {
      data = value;
    } else {
      // ArrayBufferView (Uint8Array etc.)
      const view = value as ArrayBufferView;
      data = view.buffer.slice(view.byteOffset, view.byteOffset + view.byteLength) as ArrayBuffer;
    }
    this.store.set(key, { data });
  }

  async get(key: string): Promise<{
    arrayBuffer(): Promise<ArrayBuffer>;
    json<T>(): Promise<T>;
  } | null> {
    const item = this.store.get(key);
    if (!item) return null;
    const dec = this.dec;
    return {
      arrayBuffer: async () => item.data,
      json:        async <T>() => JSON.parse(dec.decode(item.data)) as T,
    };
  }

  async head(key: string): Promise<object | null> {
    return this.store.has(key) ? {} : null;
  }

  async list(opts?: {
    prefix?:    string;
    cursor?:    string;
    delimiter?: string;
  }): Promise<{
    objects:           { key: string }[];
    truncated:         boolean;
    cursor:            string | undefined;
    delimitedPrefixes: string[];
  }> {
    const prefix    = opts?.prefix    ?? "";
    const delimiter = opts?.delimiter;

    if (delimiter) {
      const prefixSet = new Set<string>();
      for (const key of this.store.keys()) {
        if (!key.startsWith(prefix)) continue;
        const rest = key.slice(prefix.length);
        const idx  = rest.indexOf(delimiter);
        if (idx !== -1) prefixSet.add(prefix + rest.slice(0, idx + 1));
      }
      return { objects: [], truncated: false, cursor: undefined, delimitedPrefixes: [...prefixSet] };
    }

    const objects: { key: string }[] = [];
    for (const key of this.store.keys()) {
      if (key.startsWith(prefix)) objects.push({ key });
    }
    return { objects, truncated: false, cursor: undefined, delimitedPrefixes: [] };
  }

  get objectCount() { return this.store.size; }

  totalBytes(): number {
    let n = 0;
    for (const { data } of this.store.values()) n += data.byteLength;
    return n;
  }
}

// ── Fake-data generators ──────────────────────────────────────────────────────

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
      envId:        ENV_ID,
      flagKey:      FLAG_KEY,
      userKey,
      variant,
      experimentId: EXPERIMENT_ID,
      layerId:      null,
      sessionId:    null,
      timestamp:    baseTs + i * 17,          // ~17ms apart within segment window
      hashBucket:   computeHashBucket(userKey, FLAG_KEY),
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
      timestamp:    baseTs + i * 17 + 30_000,  // conversions ~30s after exposure
      sessionId:    null,
      source:       null,
    };
  }
  return records;
}

// ── Formatting helpers ────────────────────────────────────────────────────────

function fmtMs(ms: number): string {
  return ms < 1000 ? `${ms.toFixed(0)}ms` : `${(ms / 1000).toFixed(2)}s`;
}

function fmtBytes(bytes: number): string {
  if (bytes < 1_024)           return `${bytes}B`;
  if (bytes < 1_048_576)       return `${(bytes / 1_024).toFixed(1)}KB`;
  return `${(bytes / 1_048_576).toFixed(2)}MB`;
}

function hr() { console.log("─".repeat(64)); }
function banner(title: string) {
  console.log("═".repeat(64));
  console.log(`  ${title}`);
  console.log("═".repeat(64));
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  banner("FeatBit TSDB — Compaction Benchmark (in-memory)");
  console.log(`  experimentId:     ${EXPERIMENT_ID}`);
  console.log(`  envId:            ${ENV_ID}`);
  console.log(`  flagKey:          ${FLAG_KEY}`);
  console.log(`  metricEvent:      ${METRIC_EVENT}`);
  console.log(`  date:             ${DATE}`);
  console.log();
  console.log(`  Segments/table:   ${SEGMENTS_PER_TABLE}`);
  console.log(`  Records/segment:  ${RECORDS_PER_SEGMENT.toLocaleString()}`);
  console.log(`  Total FE records: ${(SEGMENTS_PER_TABLE * RECORDS_PER_SEGMENT).toLocaleString()}`);
  console.log(`  Total ME records: ${(SEGMENTS_PER_TABLE * RECORDS_PER_SEGMENT).toLocaleString()}`);
  console.log(`  Unique user pool: ${UNIQUE_USERS.toLocaleString()}`);
  console.log();

  const bucket   = new MemoryR2Bucket();
  const userPool = Array.from({ length: UNIQUE_USERS }, (_, i) => `user-${String(i).padStart(6, "0")}`);
  const dayStart = new Date(`${DATE}T00:00:00Z`).getTime();
  const msPerSeg = Math.floor(86_400_000 / SEGMENTS_PER_TABLE);   // spread evenly across day

  // ── Phase 1: Generate & store segments ─────────────────────────────────────

  console.log("Phase 1 — Generating & storing segments");
  hr();

  const fePrefix = flagEvalPrefix(ENV_ID, FLAG_KEY, DATE);
  const mePrefix = metricEventPrefix(ENV_ID, METRIC_EVENT, DATE);

  let feGenMs = 0, meGenMs = 0;
  let feBytesTotal = 0, meBytesTotal = 0;

  const phase1Start = Date.now();

  for (let s = 0; s < SEGMENTS_PER_TABLE; s++) {
    const baseTs  = dayStart + s * msPerSeg;
    const seqStr  = String(s + 1).padStart(8, "0");

    // --- flag-eval segment ---
    const t0       = Date.now();
    const feRecs   = makeFlagEvalRecords(userPool, RECORDS_PER_SEGMENT, baseTs);
    const feResult = await writeFlagEvalSegment(feRecs);
    await bucket.put(`${fePrefix}seg-${seqStr}.fbs`, feResult.data.buffer as ArrayBuffer);
    feGenMs      += Date.now() - t0;
    feBytesTotal += feResult.data.byteLength;

    // --- metric-event segment ---
    const t1       = Date.now();
    const meRecs   = makeMetricEventRecords(userPool, RECORDS_PER_SEGMENT, baseTs);
    const meResult = await writeMetricEventSegment(meRecs);
    await bucket.put(`${mePrefix}seg-${seqStr}.fbs`, meResult.data.buffer as ArrayBuffer);
    meGenMs      += Date.now() - t1;
    meBytesTotal += meResult.data.byteLength;

    if ((s + 1) % 50 === 0 || s === 0) {
      process.stdout.write(
        `  seg ${String(s + 1).padStart(3)} / ${SEGMENTS_PER_TABLE}` +
        `  fe_total=${fmtBytes(feBytesTotal).padStart(8)}` +
        `  me_total=${fmtBytes(meBytesTotal).padStart(8)}\n`,
      );
    }
  }

  const phase1Ms = Date.now() - phase1Start;

  console.log();
  console.log(`  Phase 1 complete: ${fmtMs(phase1Ms)}`);
  console.log(`  flag-eval   : ${SEGMENTS_PER_TABLE} segs, ${fmtBytes(feBytesTotal)} total, avg ${fmtBytes(Math.round(feBytesTotal / SEGMENTS_PER_TABLE))}/seg, gen=${fmtMs(feGenMs)}`);
  console.log(`  metric-event: ${SEGMENTS_PER_TABLE} segs, ${fmtBytes(meBytesTotal)} total, avg ${fmtBytes(Math.round(meBytesTotal / SEGMENTS_PER_TABLE))}/seg, gen=${fmtMs(meGenMs)}`);
  console.log(`  R2 objects stored: ${bucket.objectCount}`);
  console.log();

  // ── Phase 2: Compaction ─────────────────────────────────────────────────────

  console.log("Phase 2 — Running compact()");
  hr();
  console.log("  Reading all segments, decompressing columns, merging per-user...");
  console.log();

  const phase2Start = Date.now();
  const compactResult = await compact(bucket as unknown as R2Bucket, {
    envId:        ENV_ID,
    flagKey:      FLAG_KEY,
    metricEvents: [METRIC_EVENT],
    startDate:    DATE,
    endDate:      DATE,
    force:        false,   // DATE is yesterday → processed normally (no force needed)
  });
  const phase2Ms = Date.now() - phase2Start;

  // Inspect rollup sizes
  const feRollupKey = `rollups/flag-evals/${ENV_ID.replace(/[^\w-]/g, "_")}/${FLAG_KEY}/${DATE}.json`;
  const meRollupKey = `rollups/metric-events/${ENV_ID.replace(/[^\w-]/g, "_")}/${METRIC_EVENT}/${DATE}.json`;

  const feRollupObj = await bucket.get(feRollupKey);
  const meRollupObj = await bucket.get(meRollupKey);

  let feUsers = 0, meUsers = 0;
  let feRollupBytes = 0, meRollupBytes = 0;

  if (feRollupObj) {
    const ab = await feRollupObj.arrayBuffer();
    feRollupBytes = ab.byteLength;
    const parsed = JSON.parse(new TextDecoder().decode(ab)) as { u: Record<string, unknown> };
    feUsers = Object.keys(parsed.u).length;
  }
  if (meRollupObj) {
    const ab = await meRollupObj.arrayBuffer();
    meRollupBytes = ab.byteLength;
    const parsed = JSON.parse(new TextDecoder().decode(ab)) as { u: Record<string, unknown> };
    meUsers = Object.keys(parsed.u).length;
  }

  console.log(`  flag-eval   rollup: created=${compactResult.flagEval.created} skipped=${compactResult.flagEval.skipped}`);
  console.log(`    unique users:  ${feUsers.toLocaleString()} / ${UNIQUE_USERS.toLocaleString()} pool`);
  console.log(`    rollup size:   ${fmtBytes(feRollupBytes)}`);
  console.log();
  console.log(`  metric-event rollup: created=${compactResult.metricEvent.created} skipped=${compactResult.metricEvent.skipped}`);
  console.log(`    unique users:  ${meUsers.toLocaleString()} / ${UNIQUE_USERS.toLocaleString()} pool`);
  console.log(`    rollup size:   ${fmtBytes(meRollupBytes)}`);
  console.log();
  console.log(`  Phase 2 complete: ${fmtMs(phase2Ms)} (compact internal: ${fmtMs(compactResult.durationMs)})`);
  console.log();

  // ── Summary ─────────────────────────────────────────────────────────────────

  banner("Summary");

  const totalRecords = SEGMENTS_PER_TABLE * RECORDS_PER_SEGMENT * 2;
  const dataReadBytes = feBytesTotal + meBytesTotal;
  const segsPerSec = (SEGMENTS_PER_TABLE * 2) / (phase2Ms / 1000);
  const recsPerSec = totalRecords / (phase2Ms / 1000);

  console.log(`  Phase 1 — segment generation:  ${fmtMs(phase1Ms)}`);
  console.log(`    FE write throughput:  ${fmtMs(feGenMs / SEGMENTS_PER_TABLE)}/seg`);
  console.log(`    ME write throughput:  ${fmtMs(meGenMs / SEGMENTS_PER_TABLE)}/seg`);
  console.log();
  console.log(`  Phase 2 — compaction:           ${fmtMs(phase2Ms)}`);
  console.log(`    Segments read:        ${SEGMENTS_PER_TABLE * 2} (FE + ME)`);
  console.log(`    Compressed data read: ${fmtBytes(dataReadBytes)}`);
  console.log(`    Throughput:           ${segsPerSec.toFixed(1)} segs/s, ${Math.round(recsPerSec).toLocaleString()} records/s`);
  console.log(`    Per segment avg:      ${fmtMs(phase2Ms / (SEGMENTS_PER_TABLE * 2))}`);
  console.log();

  // Cloudflare Worker limits assessment
  const CF_CPU_LIMIT_MS = 30_000;
  const margin = CF_CPU_LIMIT_MS - phase2Ms;

  console.log("  Cloudflare Worker limit assessment:");
  console.log(`    CPU limit (paid plan):  30s`);
  console.log(`    Compaction took:        ${fmtMs(phase2Ms)}`);
  console.log(`    Headroom:               ${margin > 0 ? `+${fmtMs(margin)} ✅` : `${fmtMs(margin)} ⚠️ OVER LIMIT`}`);
  console.log();
  console.log("  ⚠️  Note: this benchmark uses in-memory R2 (zero I/O latency).");
  console.log(`     In production, each R2 GET adds ~20-100ms.`);
  console.log(`     Real cost: ~${SEGMENTS_PER_TABLE * 2} R2 GETs × ~50ms = +${fmtMs(SEGMENTS_PER_TABLE * 2 * 50)} network latency.`);
  console.log();

  process.exit(0);
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
