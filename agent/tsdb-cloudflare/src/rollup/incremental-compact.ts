/**
 * Incremental compaction — processes only NEW segments since the last run
 * and merges them into the existing daily rollup.
 *
 * Unlike compact() which always reads every segment for a day, incremental
 * compact reads a checkpoint that records the last processed segment sequence
 * number, then only fetches segments beyond that watermark.
 *
 * This keeps each compaction run O(new segments) instead of O(all segments),
 * making it viable to run every minute from a Cloudflare cron.
 *
 * Checkpoint path:
 *   rollups/checkpoints/{envId}/{flagKey}/{date}.json
 */

import { parseSegment, readSelectedColumns } from "../storage/segment-reader";
import {
  decodeTimestamps,
  decodeStrings,
  decodeNullableStrings,
  decodeNullableDoubles,
  decodeBytes,
} from "../storage/column-encoder";
import {
  flagEvalPrefix,
  metricEventPrefix,
  flagEvalRollupKey,
  metricEventRollupKey,
  sanitize,
} from "../storage/path-helper";
import type {
  FlagEvalRollup,
  FlagEvalRollupEntry,
  MetricEventRollup,
  MetricRollupEntry,
} from "./types";

const CONCURRENCY = 16;

// ── Checkpoint ────────────────────────────────────────────────────────────────

export interface CompactCheckpoint {
  /** Last flag-eval segment sequence number fully merged into the rollup. */
  feLastSeq: number;
  /** Per-event-name last segment sequence number. */
  meLastSeq: Record<string, number>;
  updatedAt: string;
}

function checkpointKey(envId: string, flagKey: string, date: string): string {
  return `rollups/checkpoints/${sanitize(envId)}/${sanitize(flagKey)}/${date}.json`;
}

export async function readCheckpoint(
  bucket: R2Bucket,
  envId: string,
  flagKey: string,
  date: string,
): Promise<CompactCheckpoint> {
  const obj = await bucket.get(checkpointKey(envId, flagKey, date));
  if (!obj) return { feLastSeq: 0, meLastSeq: {}, updatedAt: new Date(0).toISOString() };
  return obj.json() as Promise<CompactCheckpoint>;
}

export async function writeCheckpoint(
  bucket: R2Bucket,
  envId: string,
  flagKey: string,
  date: string,
  cp: CompactCheckpoint,
): Promise<void> {
  await bucket.put(checkpointKey(envId, flagKey, date), JSON.stringify(cp));
}

// ── Public API ────────────────────────────────────────────────────────────────

export interface IncrementalCompactRequest {
  envId: string;
  flagKey: string;
  metricEvents: string[];
  date: string;
}

export interface IncrementalCompactResult {
  feNewSegments: number;
  meNewSegments: Record<string, number>;
  checkpoint: CompactCheckpoint;
  durationMs: number;
}

export async function incrementalCompact(
  bucket: R2Bucket,
  req: IncrementalCompactRequest,
): Promise<IncrementalCompactResult> {
  const start = Date.now();

  // 1. Read current checkpoint
  const cp = await readCheckpoint(bucket, req.envId, req.flagKey, req.date);

  // 2. Incremental flag-eval
  const { newSegments: feNewSegs, newLastSeq: feNewSeq } =
    await incrementalFlagEval(bucket, req.envId, req.flagKey, req.date, cp.feLastSeq);
  cp.feLastSeq = feNewSeq;

  // 3. Incremental metric-events (one per event name)
  const meNewSegments: Record<string, number> = {};
  for (const eventName of req.metricEvents) {
    const fromSeq = cp.meLastSeq[eventName] ?? 0;
    const { newSegments, newLastSeq } = await incrementalMetricEvent(
      bucket, req.envId, eventName, req.date, fromSeq,
    );
    meNewSegments[eventName] = newSegments;
    cp.meLastSeq[eventName] = newLastSeq;
  }

  // 4. Persist updated checkpoint
  cp.updatedAt = new Date().toISOString();
  await writeCheckpoint(bucket, req.envId, req.flagKey, req.date, cp);

  return {
    feNewSegments: feNewSegs,
    meNewSegments,
    checkpoint: cp,
    durationMs: Date.now() - start,
  };
}

// ── Flag-eval incremental ─────────────────────────────────────────────────────

async function incrementalFlagEval(
  bucket: R2Bucket,
  envId: string,
  flagKey: string,
  date: string,
  fromSeq: number,
): Promise<{ newSegments: number; newLastSeq: number }> {
  const prefix  = flagEvalPrefix(envId, flagKey, date);
  const newKeys = await listNewKeys(bucket, prefix, fromSeq);
  if (newKeys.length === 0) return { newSegments: 0, newLastSeq: fromSeq };

  // Read existing rollup (empty object if first run)
  const rKey   = flagEvalRollupKey(envId, flagKey, date);
  const rollup = await readOrEmptyFlagEval(bucket, rKey);

  // Process new segments, merge earliest-exposure per user
  for (let i = 0; i < newKeys.length; i += CONCURRENCY) {
    const batch   = newKeys.slice(i, i + CONCURRENCY);
    const results = await Promise.all(batch.map((k) => scanFlagEvalSeg(bucket, k)));
    for (const local of results) {
      for (const [userKey, entry] of local) {
        const ex = rollup.u[userKey];
        if (!ex || entry[0] < ex[0]) rollup.u[userKey] = entry;
      }
    }
  }

  await bucket.put(rKey, JSON.stringify(rollup));

  return {
    newSegments: newKeys.length,
    newLastSeq:  seqFromKey(newKeys[newKeys.length - 1]),
  };
}

// ── Metric-event incremental ──────────────────────────────────────────────────

interface MetricAcc {
  hasConversion: boolean;
  firstTs: number; firstValue: number | null;
  latestTs: number; latestValue: number | null;
  sum: number; count: number;
}

async function incrementalMetricEvent(
  bucket: R2Bucket,
  envId: string,
  eventName: string,
  date: string,
  fromSeq: number,
): Promise<{ newSegments: number; newLastSeq: number }> {
  const prefix  = metricEventPrefix(envId, eventName, date);
  const newKeys = await listNewKeys(bucket, prefix, fromSeq);
  if (newKeys.length === 0) return { newSegments: 0, newLastSeq: fromSeq };

  const rKey   = metricEventRollupKey(envId, eventName, date);
  const rollup = await readOrEmptyMetricEvent(bucket, rKey);

  // Convert existing rollup entries to mutable accumulators
  const accMap = new Map<string, MetricAcc>();
  for (const [userKey, e] of Object.entries(rollup.u)) {
    accMap.set(userKey, {
      hasConversion: e[0] === 1,
      firstTs: e[1], firstValue: e[2],
      latestTs: e[3], latestValue: e[4],
      sum: e[5], count: e[6],
    });
  }

  // Process new segments, merge per-user stats
  for (let i = 0; i < newKeys.length; i += CONCURRENCY) {
    const batch   = newKeys.slice(i, i + CONCURRENCY);
    const results = await Promise.all(batch.map((k) => scanMetricSeg(bucket, k)));
    for (const local of results) {
      for (const [userKey, na] of local) {
        const ex = accMap.get(userKey);
        if (!ex) {
          accMap.set(userKey, na);
        } else {
          ex.hasConversion = ex.hasConversion || na.hasConversion;
          if (na.firstTs < ex.firstTs)   { ex.firstTs = na.firstTs;   ex.firstValue = na.firstValue; }
          if (na.latestTs > ex.latestTs) { ex.latestTs = na.latestTs; ex.latestValue = na.latestValue; }
          ex.sum   += na.sum;
          ex.count += na.count;
        }
      }
    }
  }

  // Write back to rollup format
  const u: Record<string, MetricRollupEntry> = {};
  for (const [k, v] of accMap) {
    u[k] = [v.hasConversion ? 1 : 0, v.firstTs, v.firstValue, v.latestTs, v.latestValue, v.sum, v.count];
  }
  rollup.u = u;
  await bucket.put(rKey, JSON.stringify(rollup));

  return {
    newSegments: newKeys.length,
    newLastSeq:  seqFromKey(newKeys[newKeys.length - 1]),
  };
}

// ── Segment scanners ──────────────────────────────────────────────────────────

async function scanFlagEvalSeg(
  bucket: R2Bucket,
  key: string,
): Promise<Map<string, FlagEvalRollupEntry>> {
  const local = new Map<string, FlagEvalRollupEntry>();
  const obj   = await bucket.get(key);
  if (!obj) return local;

  const { header, dataOffset, raw } = parseSegment(await obj.arrayBuffer());
  const needed = new Set(["timestamp", "user_key", "variant", "experiment_id", "layer_id", "hash_bucket"]);
  const cols   = readSelectedColumns(raw, header, dataOffset, needed);
  const n      = header.rowCount;

  const [timestamps, userKeys, variants] = await Promise.all([
    decodeTimestamps(cols.get("timestamp")!, n),
    decodeStrings(cols.get("user_key")!, n),
    decodeStrings(cols.get("variant")!, n),
  ]);
  const expIds   = cols.has("experiment_id") ? await decodeNullableStrings(cols.get("experiment_id")!, n) : null;
  const layerIds = cols.has("layer_id")      ? await decodeNullableStrings(cols.get("layer_id")!, n)      : null;
  const hbs      = cols.has("hash_bucket")   ? await decodeBytes(cols.get("hash_bucket")!, n)             : null;

  for (let i = 0; i < n; i++) {
    const ts  = timestamps[i];
    const uk  = userKeys[i];
    const ex  = local.get(uk);
    if (!ex || ts < ex[0]) {
      local.set(uk, [ts, variants[i], expIds?.[i] ?? null, layerIds?.[i] ?? null, hbs?.[i] ?? 0]);
    }
  }
  return local;
}

async function scanMetricSeg(
  bucket: R2Bucket,
  key: string,
): Promise<Map<string, MetricAcc>> {
  const local = new Map<string, MetricAcc>();
  const obj   = await bucket.get(key);
  if (!obj) return local;

  const { header, dataOffset, raw } = parseSegment(await obj.arrayBuffer());
  const needed = new Set(["timestamp", "user_key", "numeric_value"]);
  const cols   = readSelectedColumns(raw, header, dataOffset, needed);
  const n      = header.rowCount;

  const [timestamps, userKeys] = await Promise.all([
    decodeTimestamps(cols.get("timestamp")!, n),
    decodeStrings(cols.get("user_key")!, n),
  ]);
  const values = cols.has("numeric_value") ? await decodeNullableDoubles(cols.get("numeric_value")!, n) : null;

  for (let i = 0; i < n; i++) {
    const ts  = timestamps[i];
    const uk  = userKeys[i];
    const val = values?.[i] ?? null;
    let acc   = local.get(uk);
    if (!acc) {
      acc = {
        hasConversion: false,
        firstTs: Number.MAX_SAFE_INTEGER, firstValue: null,
        latestTs: Number.MIN_SAFE_INTEGER, latestValue: null,
        sum: 0, count: 0,
      };
      local.set(uk, acc);
    }
    acc.hasConversion = true;
    if (ts < acc.firstTs)  { acc.firstTs = ts;  acc.firstValue = val; }
    if (ts > acc.latestTs) { acc.latestTs = ts; acc.latestValue = val; }
    if (val !== null) { acc.sum += val; acc.count++; }
  }
  return local;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function seqFromKey(key: string): number {
  const m = (key.split("/").pop() ?? "").match(/^seg-(\d+)\.fbs$/);
  return m ? parseInt(m[1], 10) : 0;
}

async function listNewKeys(bucket: R2Bucket, prefix: string, fromSeq: number): Promise<string[]> {
  const keys: string[] = [];
  let cursor: string | undefined;
  do {
    const list = await bucket.list({ prefix, cursor });
    for (const obj of list.objects) {
      if (seqFromKey(obj.key) > fromSeq) keys.push(obj.key);
    }
    cursor = list.truncated ? list.cursor : undefined;
  } while (cursor);
  return keys.sort();
}

async function readOrEmptyFlagEval(bucket: R2Bucket, key: string): Promise<FlagEvalRollup> {
  const obj = await bucket.get(key);
  if (!obj) return { v: 1, u: {} };
  return obj.json() as Promise<FlagEvalRollup>;
}

async function readOrEmptyMetricEvent(bucket: R2Bucket, key: string): Promise<MetricEventRollup> {
  const obj = await bucket.get(key);
  if (!obj) return { v: 1, u: {} };
  return obj.json() as Promise<MetricEventRollup>;
}
