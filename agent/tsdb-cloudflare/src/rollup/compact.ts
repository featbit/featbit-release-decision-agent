/**
 * Compaction: reads raw .fbs segments for completed days and writes
 * a single JSON rollup per day to R2.
 *
 * Rollups are pre-aggregated per-user data (no query filters applied).
 * Query-time filters (experimentId, traffic, audience) are evaluated
 * when the rollup is read during a query.
 */

import {
  parseSegment,
  readSelectedColumns,
} from "../storage/segment-reader";
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
} from "../storage/path-helper";
import type {
  FlagEvalRollup,
  FlagEvalRollupEntry,
  MetricEventRollup,
  MetricRollupEntry,
} from "./types";

const CONCURRENCY = 16;

// ── Public API ────────────────────────────────────────────────────────────────

export interface CompactRequest {
  envId: string;
  flagKey: string;
  metricEvents: string[];
  startDate: string;
  endDate: string;
  force?: boolean;
}

export interface CompactResult {
  flagEval: { created: number; skipped: number };
  metricEvent: { created: number; skipped: number };
  durationMs: number;
}

export async function compact(
  bucket: R2Bucket,
  req: CompactRequest,
): Promise<CompactResult> {
  const start = Date.now();
  const dates = dateRange(req.startDate, req.endDate);

  // Don't compact today — data may still be arriving (skip guard when force=true).
  const today = new Date().toISOString().slice(0, 10);
  const compactableDates = req.force ? dates : dates.filter((d) => d !== today);

  const feResult = { created: 0, skipped: 0 };
  const meResult = { created: 0, skipped: 0 };

  // Compact flag-eval rollups.
  for (const date of compactableDates) {
    const key = flagEvalRollupKey(req.envId, req.flagKey, date);
    if (!req.force) {
      const existing = await bucket.head(key);
      if (existing) {
        feResult.skipped++;
        continue;
      }
    }
    const rollup = await compactFlagEvalDay(
      bucket,
      req.envId,
      req.flagKey,
      date,
    );
    if (rollup && Object.keys(rollup.u).length > 0) {
      await bucket.put(key, JSON.stringify(rollup));
      feResult.created++;
    } else {
      feResult.skipped++;
    }
  }

  // Compact metric-event rollups.
  for (const eventName of req.metricEvents) {
    for (const date of compactableDates) {
      const key = metricEventRollupKey(req.envId, eventName, date);
      if (!req.force) {
        const existing = await bucket.head(key);
        if (existing) {
          meResult.skipped++;
          continue;
        }
      }
      const rollup = await compactMetricEventDay(
        bucket,
        req.envId,
        eventName,
        date,
      );
      if (rollup && Object.keys(rollup.u).length > 0) {
        await bucket.put(key, JSON.stringify(rollup));
        meResult.created++;
      } else {
        meResult.skipped++;
      }
    }
  }

  return {
    flagEval: feResult,
    metricEvent: meResult,
    durationMs: Date.now() - start,
  };
}

// ── Flag-eval compaction ──────────────────────────────────────────────────────

async function compactFlagEvalDay(
  bucket: R2Bucket,
  envId: string,
  flagKey: string,
  date: string,
): Promise<FlagEvalRollup | null> {
  const prefix = flagEvalPrefix(envId, flagKey, date);
  const segKeys = await listAllKeys(bucket, prefix);
  if (segKeys.length === 0) return null;

  const users = new Map<string, FlagEvalRollupEntry>();

  for (let i = 0; i < segKeys.length; i += CONCURRENCY) {
    const batch = segKeys.slice(i, i + CONCURRENCY);
    const results = await Promise.all(
      batch.map((key) => scanFlagEvalSegmentForRollup(bucket, key)),
    );
    for (const local of results) {
      for (const [userKey, entry] of local) {
        const existing = users.get(userKey);
        // Keep earliest exposure per user.
        if (!existing || entry[0] < existing[0]) {
          users.set(userKey, entry);
        }
      }
    }
  }

  const u: Record<string, FlagEvalRollupEntry> = {};
  for (const [k, v] of users) u[k] = v;
  return { v: 1, u };
}

async function scanFlagEvalSegmentForRollup(
  bucket: R2Bucket,
  key: string,
): Promise<Map<string, FlagEvalRollupEntry>> {
  const local = new Map<string, FlagEvalRollupEntry>();

  const obj = await bucket.get(key);
  if (!obj) return local;

  const { header, dataOffset, raw } = parseSegment(await obj.arrayBuffer());

  const needed = new Set([
    "timestamp",
    "user_key",
    "variant",
    "experiment_id",
    "layer_id",
    "hash_bucket",
  ]);
  const cols = readSelectedColumns(raw, header, dataOffset, needed);
  const n = header.rowCount;

  const [timestamps, userKeys, variants] = await Promise.all([
    decodeTimestamps(cols.get("timestamp")!, n),
    decodeStrings(cols.get("user_key")!, n),
    decodeStrings(cols.get("variant")!, n),
  ]);

  const experimentIds = cols.has("experiment_id")
    ? await decodeNullableStrings(cols.get("experiment_id")!, n)
    : null;
  const layerIds = cols.has("layer_id")
    ? await decodeNullableStrings(cols.get("layer_id")!, n)
    : null;
  const hashBuckets = cols.has("hash_bucket")
    ? await decodeBytes(cols.get("hash_bucket")!, n)
    : null;

  for (let i = 0; i < n; i++) {
    const ts = timestamps[i];
    const userKey = userKeys[i];
    const existing = local.get(userKey);

    if (!existing || ts < existing[0]) {
      local.set(userKey, [
        ts,
        variants[i],
        experimentIds ? experimentIds[i] : null,
        layerIds ? layerIds[i] : null,
        hashBuckets ? hashBuckets[i] : 0,
      ]);
    }
  }

  return local;
}

// ── Metric-event compaction ───────────────────────────────────────────────────

interface MetricAcc {
  hasConversion: boolean;
  firstTs: number;
  firstValue: number | null;
  latestTs: number;
  latestValue: number | null;
  sum: number;
  count: number;
}

async function compactMetricEventDay(
  bucket: R2Bucket,
  envId: string,
  eventName: string,
  date: string,
): Promise<MetricEventRollup | null> {
  const prefix = metricEventPrefix(envId, eventName, date);
  const segKeys = await listAllKeys(bucket, prefix);
  if (segKeys.length === 0) return null;

  const users = new Map<string, MetricAcc>();

  for (let i = 0; i < segKeys.length; i += CONCURRENCY) {
    const batch = segKeys.slice(i, i + CONCURRENCY);
    const results = await Promise.all(
      batch.map((key) => scanMetricSegmentForRollup(bucket, key)),
    );
    for (const local of results) {
      for (const [userKey, localAcc] of local) {
        const existing = users.get(userKey);
        if (!existing) {
          users.set(userKey, localAcc);
        } else {
          existing.hasConversion = existing.hasConversion || localAcc.hasConversion;
          if (localAcc.firstTs < existing.firstTs) {
            existing.firstTs = localAcc.firstTs;
            existing.firstValue = localAcc.firstValue;
          }
          if (localAcc.latestTs > existing.latestTs) {
            existing.latestTs = localAcc.latestTs;
            existing.latestValue = localAcc.latestValue;
          }
          existing.sum += localAcc.sum;
          existing.count += localAcc.count;
        }
      }
    }
  }

  const u: Record<string, MetricRollupEntry> = {};
  for (const [k, v] of users) {
    u[k] = [
      v.hasConversion ? 1 : 0,
      v.firstTs,
      v.firstValue,
      v.latestTs,
      v.latestValue,
      v.sum,
      v.count,
    ];
  }
  return { v: 1, u };
}

async function scanMetricSegmentForRollup(
  bucket: R2Bucket,
  key: string,
): Promise<Map<string, MetricAcc>> {
  const local = new Map<string, MetricAcc>();

  const obj = await bucket.get(key);
  if (!obj) return local;

  const { header, dataOffset, raw } = parseSegment(await obj.arrayBuffer());

  const needed = new Set(["timestamp", "user_key", "numeric_value"]);
  const cols = readSelectedColumns(raw, header, dataOffset, needed);
  const n = header.rowCount;

  const [timestamps, userKeys] = await Promise.all([
    decodeTimestamps(cols.get("timestamp")!, n),
    decodeStrings(cols.get("user_key")!, n),
  ]);

  const numericValues = cols.has("numeric_value")
    ? await decodeNullableDoubles(cols.get("numeric_value")!, n)
    : null;

  for (let i = 0; i < n; i++) {
    const ts = timestamps[i];
    const userKey = userKeys[i];
    const value = numericValues ? numericValues[i] : null;

    let acc = local.get(userKey);
    if (!acc) {
      acc = {
        hasConversion: false,
        firstTs: Number.MAX_SAFE_INTEGER,
        firstValue: null,
        latestTs: Number.MIN_SAFE_INTEGER,
        latestValue: null,
        sum: 0,
        count: 0,
      };
      local.set(userKey, acc);
    }

    acc.hasConversion = true;
    // Always update timestamps (needed for post-exposure filtering in roller)
    if (ts < acc.firstTs) {
      acc.firstTs = ts;
      acc.firstValue = value;
    }
    if (ts > acc.latestTs) {
      acc.latestTs = ts;
      acc.latestValue = value;
    }
    // Only accumulate numeric stats for non-null values
    if (value !== null) {
      acc.sum += value;
      acc.count++;
    }
  }

  return local;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function dateRange(startDate: string, endDate: string): string[] {
  const dates: string[] = [];
  const start = new Date(startDate + "T00:00:00Z");
  const end = new Date(endDate + "T00:00:00Z");
  for (let d = new Date(start); d <= end; d.setUTCDate(d.getUTCDate() + 1)) {
    dates.push(d.toISOString().slice(0, 10));
  }
  return dates;
}

async function listAllKeys(
  bucket: R2Bucket,
  prefix: string,
): Promise<string[]> {
  const keys: string[] = [];
  let cursor: string | undefined;
  do {
    const list = await bucket.list({ prefix, cursor });
    for (const obj of list.objects) {
      keys.push(obj.key);
    }
    cursor = list.truncated ? list.cursor : undefined;
  } while (cursor);
  return keys;
}
