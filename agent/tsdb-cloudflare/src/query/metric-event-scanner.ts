/**
 * Scans metric-event segments on R2 and aggregates results
 * for users present in the exposure map.
 *
 * JOIN logic (mirrors .NET MetricEventScanner):
 *   • user_key must be in exposureMap
 *   • occurred_at ≥ user's first_exposed_at (post-exposure only)
 *   • occurred_at within [query.startMs, query.endMs]
 *
 * Binary metric  → counts distinct exposed users who triggered ≥1 event.
 * Continuous metric → computes per-user aggregated value (once/sum/mean/count/latest),
 *                     then per-variant (n, mean, variance, total) via Welford's algorithm.
 */

import type {
  ExperimentQuery,
  ExposureEntry,
  ExperimentQueryResponse,
  VariantStatsDto,
} from "../models/dtos";
import {
  parseHeaderFromMetadata,
  parseSegment,
  overlapsTimeRange,
  readSelectedColumns,
} from "../storage/segment-reader";
import {
  decodeTimestamps,
  decodeStrings,
  decodeNullableDoubles,
} from "../storage/column-encoder";
import { metricEventPrefixes, metricEventPrefix, dateRange } from "../storage/path-helper";
import { readMetricRollup, listMetricRollupDates, listMetricRawDates } from "../rollup/reader";

/** Max concurrent R2 segment fetches. */
const CONCURRENCY = 16;

// ── Per-user accumulator ──────────────────────────────────────────────────────

export class UserAccumulator {
  hasConversion = false;
  firstTs = Number.MAX_SAFE_INTEGER;
  firstValue: number | null = null;
  latestTs = Number.MIN_SAFE_INTEGER;
  latestValue: number | null = null;
  sum = 0;
  count = 0;

  addEvent(numericValue: number | null, occurredAt: number): void {
    this.hasConversion = true;
    if (numericValue === null) return;

    if (occurredAt < this.firstTs) {
      this.firstTs = occurredAt;
      this.firstValue = numericValue;
    }
    if (occurredAt > this.latestTs) {
      this.latestTs = occurredAt;
      this.latestValue = numericValue;
    }
    this.sum += numericValue;
    this.count++;
  }

  /** Merge a pre-aggregated rollup entry into this accumulator. */
  mergeFromRollup(
    hasConv: boolean,
    fTs: number,
    fVal: number | null,
    lTs: number,
    lVal: number | null,
    s: number,
    c: number,
  ): void {
    if (!hasConv) return;
    this.hasConversion = true;
    if (fTs < this.firstTs) {
      this.firstTs = fTs;
      this.firstValue = fVal;
    }
    if (lTs > this.latestTs) {
      this.latestTs = lTs;
      this.latestValue = lVal;
    }
    this.sum += s;
    this.count += c;
  }

  getValue(agg: string): number | null {
    switch (agg) {
      case "once":
        return this.firstValue;
      case "sum":
        return this.count > 0 ? this.sum : null;
      case "mean":
        return this.count > 0 ? this.sum / this.count : null;
      case "count":
        return this.count > 0 ? this.count : null;
      case "latest":
        return this.latestValue;
      default:
        return this.count > 0 ? this.sum : null;
    }
  }

  merge(other: UserAccumulator): void {
    if (!other.hasConversion) return;
    this.hasConversion = true;
    if (other.firstTs < this.firstTs) {
      this.firstTs = other.firstTs;
      this.firstValue = other.firstValue;
    }
    if (other.latestTs > this.latestTs) {
      this.latestTs = other.latestTs;
      this.latestValue = other.latestValue;
    }
    this.sum += other.sum;
    this.count += other.count;
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

export async function aggregateMetricEvents(
  bucket: R2Bucket,
  query: ExperimentQuery,
  exposureMap: ReadonlyMap<string, ExposureEntry>,
): Promise<ExperimentQueryResponse> {
  const isBinary = query.metricType === "binary";

  const perUser = new Map<string, UserAccumulator>();

  // Parallel discovery: which dates have rollups, which have raw data?
  const [rollupDates, rawDates] = await Promise.all([
    listMetricRollupDates(bucket, query.envId, query.metricEvent),
    listMetricRawDates(bucket, query.envId, query.metricEvent),
  ]);

  if (rollupDates.size > 0 || rawDates.size > 0) {
    // For continuous metrics, compute the set of dates where ≥1 user was
    // first exposed. On those dates the rollup mixes pre- and post-exposure
    // events, so we must fall back to raw scanning.
    const exposureDates = new Set<string>();
    if (!isBinary) {
      for (const entry of exposureMap.values()) {
        const d = new Date(entry.firstExposedAt).toISOString().slice(0, 10);
        exposureDates.add(d);
      }
    }

    const dates = dateRange(query.startDate, query.endDate);
    const coldDates: string[] = [];
    const hotDates: string[] = [];

    for (const d of dates) {
      const hasRollup = rollupDates.has(d);
      const hasRaw = rawDates.has(d);

      // Skip dates with no data at all.
      if (!hasRollup && !hasRaw) continue;

      const dayStartMs = Date.parse(d + "T00:00:00Z");
      // Use rollup when it exists, query fully covers the day (1s tolerance),
      // and (for continuous) not an exposure-overlap day.
      if (
        hasRollup &&
        query.startMs <= dayStartMs &&
        query.endMs >= dayStartMs + 86_399_000 &&
        (isBinary || !exposureDates.has(d))
      ) {
        coldDates.push(d);
      } else {
        hotDates.push(d);
      }
    }

    // Read only the rollups that actually exist, in parallel.
    if (coldDates.length > 0) {
      const rollups = await Promise.all(
        coldDates.map((d) =>
          readMetricRollup(bucket, query.envId, query.metricEvent, d),
        ),
      );

      for (const rollup of rollups) {
        if (!rollup) continue;

        for (const [userKey, entry] of Object.entries(rollup.u)) {
          const exposure = exposureMap.get(userKey);
          if (!exposure) continue;

          const [hasConv, fTs, fVal, lTs, lVal, s, c] = entry;

          if (isBinary) {
            if (lTs < exposure.firstExposedAt) continue;
          }
          // Continuous: all events on this date are guaranteed post-exposure
          // (we excluded exposure-overlap dates above).

          let acc = perUser.get(userKey);
          if (!acc) {
            acc = new UserAccumulator();
            perUser.set(userKey, acc);
          }
          acc.mergeFromRollup(!!hasConv, fTs, fVal, lTs, lVal, s, c);
        }
      }
    }

    // Scan raw segments only for hot dates.
    if (hotDates.length > 0) {
      const hotPrefixes = hotDates.map((d) =>
        metricEventPrefix(query.envId, query.metricEvent, d),
      );
      await scanRawIntoPerUser(
        bucket,
        hotPrefixes,
        query,
        exposureMap,
        isBinary,
        perUser,
      );
    }

    return isBinary
      ? buildBinaryResult(query, exposureMap, perUser)
      : buildContinuousResult(query, exposureMap, perUser);
  }

  // No rollups — full raw-segment path.
  const prefixes = metricEventPrefixes(
    query.envId,
    query.metricEvent,
    query.startDate,
    query.endDate,
  );
  await scanRawIntoPerUser(
    bucket,
    prefixes,
    query,
    exposureMap,
    isBinary,
    perUser,
  );

  return isBinary
    ? buildBinaryResult(query, exposureMap, perUser)
    : buildContinuousResult(query, exposureMap, perUser);
}

/**
 * Scan raw segments for the given prefixes and merge into perUser map.
 */
async function scanRawIntoPerUser(
  bucket: R2Bucket,
  prefixes: string[],
  query: ExperimentQuery,
  exposureMap: ReadonlyMap<string, ExposureEntry>,
  isBinary: boolean,
  perUser: Map<string, UserAccumulator>,
): Promise<void> {
  const segKeys = await listSegmentKeys(bucket, prefixes, query);

  for (let i = 0; i < segKeys.length; i += CONCURRENCY) {
    const batch = segKeys.slice(i, i + CONCURRENCY);
    const locals = await Promise.all(
      batch.map((key) =>
        scanSegment(bucket, key, query, exposureMap, isBinary),
      ),
    );
    for (const local of locals) {
      for (const [userKey, acc] of local) {
        const existing = perUser.get(userKey);
        if (existing) {
          existing.merge(acc);
        } else {
          perUser.set(userKey, acc);
        }
      }
    }
  }
}

// ── Per-segment scan ──────────────────────────────────────────────────────────

async function scanSegment(
  bucket: R2Bucket,
  key: string,
  query: ExperimentQuery,
  exposureMap: ReadonlyMap<string, ExposureEntry>,
  isBinary: boolean,
): Promise<Map<string, UserAccumulator>> {
  const local = new Map<string, UserAccumulator>();

  const obj = await bucket.get(key);
  if (!obj) return local;

  const seg = parseSegment(await obj.arrayBuffer());
  const { header, dataOffset, raw } = seg;

  if (!overlapsTimeRange(header, query.startMs, query.endMs)) return local;

  // For continuous we need numeric_value; for binary we don't.
  const needed = isBinary
    ? new Set(["timestamp", "user_key"])
    : new Set(["timestamp", "user_key", "numeric_value"]);

  const cols = readSelectedColumns(raw, header, dataOffset, needed);
  const n = header.rowCount;

  const [timestamps, userKeys] = await Promise.all([
    decodeTimestamps(cols.get("timestamp")!, n),
    decodeStrings(cols.get("user_key")!, n),
  ]);

  const numericValues = !isBinary
    ? await decodeNullableDoubles(cols.get("numeric_value")!, n)
    : null;

  for (let i = 0; i < n; i++) {
    const ts = timestamps[i];
    const userKey = userKeys[i];

    if (ts < query.startMs || ts > query.endMs) continue;

    // Must be an exposed user.
    const exposure = exposureMap.get(userKey);
    if (!exposure) continue;

    // Post-exposure only.
    if (ts < exposure.firstExposedAt) continue;

    const value = numericValues ? numericValues[i] : null;

    let acc = local.get(userKey);
    if (!acc) {
      acc = new UserAccumulator();
      local.set(userKey, acc);
    }
    acc.addEvent(value, ts);
  }

  return local;
}

// ── Result builders ───────────────────────────────────────────────────────────

function buildBinaryResult(
  query: ExperimentQuery,
  exposureMap: ReadonlyMap<string, ExposureEntry>,
  perUser: ReadonlyMap<string, UserAccumulator>,
): ExperimentQueryResponse {
  const variants: Record<string, VariantStatsDto> = {};

  for (const variant of query.allVariants) {
    let n = 0;
    let k = 0;
    for (const [userKey, entry] of exposureMap) {
      if (entry.variant !== variant) continue;
      n++;
      const acc = perUser.get(userKey);
      if (acc?.hasConversion) k++;
    }
    variants[variant] = { n, k };
  }

  return { metricType: query.metricType, variants };
}

function buildContinuousResult(
  query: ExperimentQuery,
  exposureMap: ReadonlyMap<string, ExposureEntry>,
  perUser: ReadonlyMap<string, UserAccumulator>,
): ExperimentQueryResponse {
  const variants: Record<string, VariantStatsDto> = {};

  for (const variant of query.allVariants) {
    // Collect per-user aggregated values.
    const userValues: number[] = [];
    for (const [userKey, entry] of exposureMap) {
      if (entry.variant !== variant) continue;
      const acc = perUser.get(userKey);
      if (!acc) continue;
      const val = acc.getValue(query.metricAgg);
      if (val !== null) userValues.push(val);
    }

    if (userValues.length === 0) {
      variants[variant] = { n: 0, mean: 0, variance: 0, total: 0 };
      continue;
    }

    // Welford's one-pass algorithm for numerically stable mean + variance.
    let mean = 0;
    let m2 = 0;
    let total = 0;
    let n = 0;

    for (const v of userValues) {
      n++;
      const delta = v - mean;
      mean += delta / n;
      m2 += delta * (v - mean);
      total += v;
    }

    const variance = n > 1 ? m2 / (n - 1) : 0;
    variants[variant] = { n, mean, variance, total };
  }

  return { metricType: query.metricType, variants };
}

// ── R2 key listing ────────────────────────────────────────────────────────────

async function listSegmentKeys(
  bucket: R2Bucket,
  prefixes: string[],
  query: ExperimentQuery,
): Promise<string[]> {
  const keys: string[] = [];
  for (const prefix of prefixes) {
    let cursor: string | undefined;
    do {
      const list = await bucket.list({ prefix, cursor });
      for (const obj of list.objects) {
        const header = obj.customMetadata
          ? parseHeaderFromMetadata(obj.customMetadata)
          : null;
        if (header && !overlapsTimeRange(header, query.startMs, query.endMs)) {
          continue;
        }

        keys.push(obj.key);
      }
      cursor = list.truncated ? list.cursor : undefined;
    } while (cursor);
  }
  return keys;
}
