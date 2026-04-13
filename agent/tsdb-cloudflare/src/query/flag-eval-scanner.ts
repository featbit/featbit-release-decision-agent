/**
 * Scans flag-evaluation segments on R2 to build an exposure map:
 *   user_key → { firstExposedAt, variant }
 *
 * Mirrors .NET FlagEvalScanner:
 *   • Filters by time range, experiment_id, layer_id, traffic bucket, audience props
 *   • Keeps only the FIRST evaluation per user (min timestamp)
 *   • Applies balanced sampling when method = "bayesian_ab"
 */

import type {
  ExperimentQuery,
  ExposureEntry,
  AudienceFilter,
} from "../models/dtos";
import { audienceFilterMatches } from "../models/dtos";
import { hashForBalance } from "../lib/hash";
import {
  parseHeaderFromMetadata,
  parseSegment,
  overlapsTimeRange,
  mightContain,
  readSelectedColumns,
} from "../storage/segment-reader";
import type { SegmentHeader } from "../storage/segment-format";
import {
  decodeTimestamps,
  decodeStrings,
  decodeNullableStrings,
  decodeBytes,
} from "../storage/column-encoder";
import { flagEvalPrefix, flagEvalPrefixes, dateRange } from "../storage/path-helper";
import { readFlagEvalRollup, listFlagEvalRollupDates, listFlagEvalRawDates } from "../rollup/reader";

/** Max concurrent R2 segment fetches. */
const CONCURRENCY = 16;

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Build the exposure map for an experiment query.
 * Returns user_key → ExposureEntry (first_exposed_at, variant).
 * Only control and treatment variants are included.
 *
 * Uses daily rollups for cold days when available, falling back to
 * raw segment scanning for hot days and when audience filters are active.
 */
export async function buildExposureMap(
  bucket: R2Bucket,
  query: ExperimentQuery,
): Promise<Map<string, ExposureEntry>> {
  const validVariants = new Set(query.allVariants);

  const needExperimentId = query.experimentId !== null;
  const needLayerId = query.layerId !== null;
  const needBucket = query.trafficPercent < 100;
  const needProps =
    query.audienceFilters !== null && query.audienceFilters.length > 0;

  const exposureMap = new Map<string, ExposureEntry>();

  // Rollups don't contain user_props — skip tiered path when audience filters are active.
  if (!needProps) {
    // Parallel discovery: which dates have rollups, which have raw data?
    const [rollupDates, rawDates] = await Promise.all([
      listFlagEvalRollupDates(bucket, query.envId, query.flagKey),
      listFlagEvalRawDates(bucket, query.envId, query.flagKey),
    ]);

    if (rollupDates.size > 0 || rawDates.size > 0) {
      const dates = dateRange(query.startDate, query.endDate);
      const coldDates: string[] = [];
      const hotDates: string[] = [];

      for (const d of dates) {
        const hasRollup = rollupDates.has(d);
        const hasRaw = rawDates.has(d);

        // Skip dates with no data at all.
        if (!hasRollup && !hasRaw) continue;

        const dayStartMs = Date.parse(d + "T00:00:00Z");
        // Use rollup when it exists and the query fully covers the day.
        // 1-second tolerance for common "23:59:59" end-of-day convention.
        if (
          hasRollup &&
          query.startMs <= dayStartMs &&
          query.endMs >= dayStartMs + 86_399_000
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
            readFlagEvalRollup(bucket, query.envId, query.flagKey, d),
          ),
        );

        for (const rollup of rollups) {
          if (!rollup) continue;
          for (const [userKey, entry] of Object.entries(rollup.u)) {
            const [ts, variant, expId, layerId, hashBucket] = entry;

            if (ts < query.startMs || ts > query.endMs) continue;
            if (!validVariants.has(variant)) continue;
            if (needExperimentId && expId !== query.experimentId) continue;
            if (needLayerId && layerId !== query.layerId) continue;
            if (
              needBucket &&
              (hashBucket < query.trafficOffset ||
                hashBucket >= query.trafficOffset + query.trafficPercent)
            )
              continue;

            const existing = exposureMap.get(userKey);
            if (!existing || ts < existing.firstExposedAt) {
              exposureMap.set(userKey, { firstExposedAt: ts, variant });
            }
          }
        }
      }

      // Scan raw segments only for hot dates.
      if (hotDates.length > 0) {
        const hotPrefixes = hotDates.map((d) =>
          flagEvalPrefix(query.envId, query.flagKey, d),
        );
        await scanRawIntoExposureMap(
          bucket,
          hotPrefixes,
          query,
          validVariants,
          needExperimentId,
          needLayerId,
          needBucket,
          needProps,
          exposureMap,
        );
      }

      return exposureMap;
    }
  }

  // No rollups available or audience filters active — full raw-segment path.
  const prefixes = flagEvalPrefixes(
    query.envId,
    query.flagKey,
    query.startDate,
    query.endDate,
  );
  await scanRawIntoExposureMap(
    bucket,
    prefixes,
    query,
    validVariants,
    needExperimentId,
    needLayerId,
    needBucket,
    needProps,
    exposureMap,
  );

  return exposureMap;
}

/**
 * Scan raw segments for the given prefixes and merge into the exposure map.
 */
async function scanRawIntoExposureMap(
  bucket: R2Bucket,
  prefixes: string[],
  query: ExperimentQuery,
  validVariants: Set<string>,
  needExperimentId: boolean,
  needLayerId: boolean,
  needBucket: boolean,
  needProps: boolean,
  exposureMap: Map<string, ExposureEntry>,
): Promise<void> {
  const segKeys = await listSegmentKeys(
    bucket,
    prefixes,
    query,
    validVariants,
    needExperimentId,
  );

  for (let i = 0; i < segKeys.length; i += CONCURRENCY) {
    const batch = segKeys.slice(i, i + CONCURRENCY);
    const locals = await Promise.all(
      batch.map((key) =>
        scanSegment(
          bucket,
          key,
          query,
          validVariants,
          needExperimentId,
          needLayerId,
          needBucket,
          needProps,
        ),
      ),
    );
    for (const local of locals) {
      for (const [userKey, entry] of local) {
        const existing = exposureMap.get(userKey);
        if (!existing || entry.firstExposedAt < existing.firstExposedAt) {
          exposureMap.set(userKey, entry);
        }
      }
    }
  }
}

/**
 * Balanced sampling (bayesian_ab): downsample larger variant(s) to
 * min(n_control, n_treatment …) using deterministic hash on user_key.
 * Mutates the map in place. No-op for method="bandit".
 */
export function balanceExposureMap(
  exposureMap: Map<string, ExposureEntry>,
  query: ExperimentQuery,
): void {
  if (query.method === "bandit") return;

  // Count per variant.
  const counts = new Map<string, number>();
  for (const entry of exposureMap.values()) {
    counts.set(entry.variant, (counts.get(entry.variant) ?? 0) + 1);
  }

  if (counts.size < 2) return;

  const minCount = Math.min(...counts.values());

  // For each over-represented variant, sort users by hash, remove tail.
  for (const [variant, count] of counts) {
    if (count <= minCount) continue;

    const usersOfVariant: [string, number][] = [];
    for (const [userKey, entry] of exposureMap) {
      if (entry.variant === variant) {
        usersOfVariant.push([userKey, hashForBalance(userKey)]);
      }
    }

    // Sort ascending by hash then remove everything beyond minCount.
    usersOfVariant.sort((a, b) => a[1] - b[1]);
    for (let i = minCount; i < usersOfVariant.length; i++) {
      exposureMap.delete(usersOfVariant[i][0]);
    }
  }
}

// ── Per-segment scan ──────────────────────────────────────────────────────────

async function scanSegment(
  bucket: R2Bucket,
  key: string,
  query: ExperimentQuery,
  validVariants: Set<string>,
  needExperimentId: boolean,
  needLayerId: boolean,
  needBucket: boolean,
  needProps: boolean,
): Promise<Map<string, ExposureEntry>> {
  const local = new Map<string, ExposureEntry>();

  const obj = await bucket.get(key);
  if (!obj) return local;

  const seg = parseSegment(await obj.arrayBuffer());
  const { header, dataOffset, raw } = seg;

  // Zone-map pruning.
  if (!overlapsTimeRange(header, query.startMs, query.endMs)) return local;

  // Determine which columns to decode.
  const needed = new Set(["timestamp", "user_key", "variant"]);
  if (needExperimentId) needed.add("experiment_id");
  if (needLayerId) needed.add("layer_id");
  if (needBucket) needed.add("hash_bucket");
  if (needProps) needed.add("user_props");

  const cols = readSelectedColumns(raw, header, dataOffset, needed);

  // Decode only fetched columns.
  const n = header.rowCount;
  const [timestamps, userKeys, variants] = await Promise.all([
    decodeTimestamps(cols.get("timestamp")!, n),
    decodeStrings(cols.get("user_key")!, n),
    decodeStrings(cols.get("variant")!, n),
  ]);

  const experimentIds = needExperimentId
    ? await decodeNullableStrings(cols.get("experiment_id")!, n)
    : null;
  const layerIds = needLayerId
    ? await decodeNullableStrings(cols.get("layer_id")!, n)
    : null;
  const hashBuckets = needBucket
    ? await decodeBytes(cols.get("hash_bucket")!, n)
    : null;
  const userPropsJsons = needProps
    ? await decodeNullableStrings(cols.get("user_props")!, n)
    : null;

  // Row-level filtering.
  for (let i = 0; i < n; i++) {
    const ts = timestamps[i];
    if (ts < query.startMs || ts > query.endMs) continue;

    const variant = variants[i];
    if (!validVariants.has(variant)) continue;

    if (experimentIds !== null && experimentIds[i] !== query.experimentId) continue;
    if (layerIds !== null && layerIds[i] !== query.layerId) continue;

    if (hashBuckets !== null) {
      const b = hashBuckets[i];
      if (b < query.trafficOffset || b >= query.trafficOffset + query.trafficPercent) continue;
    }

    if (
      userPropsJsons !== null &&
      query.audienceFilters !== null &&
      query.audienceFilters.length > 0
    ) {
      const propsJson = userPropsJsons[i];
      const props: Record<string, string> | null = propsJson
        ? JSON.parse(propsJson)
        : null;

      let passes = true;
      for (const f of query.audienceFilters) {
        if (!audienceFilterMatches(f, props)) {
          passes = false;
          break;
        }
      }
      if (!passes) continue;
    }

    // Keep only FIRST evaluation per user (min timestamp).
    const userKey = userKeys[i];
    const existing = local.get(userKey);
    if (!existing || ts < existing.firstExposedAt) {
      local.set(userKey, { firstExposedAt: ts, variant });
    }
  }

  return local;
}

// ── R2 key listing ────────────────────────────────────────────────────────────

async function listSegmentKeys(
  bucket: R2Bucket,
  prefixes: string[],
  query: ExperimentQuery,
  validVariants: ReadonlySet<string>,
  needExperimentId: boolean,
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

        if (header) {
          let variantMatch = false;
          for (const variant of validVariants) {
            if (mightContain(header, "variant", variant)) {
              variantMatch = true;
              break;
            }
          }

          if (!variantMatch) {
            continue;
          }

          if (
            needExperimentId &&
            query.experimentId !== null &&
            !mightContain(header, "experiment_id", query.experimentId)
          ) {
            continue;
          }
        }

        keys.push(obj.key);
      }
      cursor = list.truncated ? list.cursor : undefined;
    } while (cursor);
  }
  return keys;
}
