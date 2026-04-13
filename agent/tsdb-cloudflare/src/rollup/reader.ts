/**
 * Rollup reader — fetches and parses daily rollup files from R2.
 */

import type { FlagEvalRollup, MetricEventRollup } from "./types";
import {
  flagEvalRollupKey,
  flagEvalRollupPrefix,
  metricEventRollupKey,
  metricEventRollupPrefix,
  sanitize,
} from "../storage/path-helper";

/**
 * Read a flag-eval daily rollup from R2. Returns null if not found.
 */
export async function readFlagEvalRollup(
  bucket: R2Bucket,
  envId: string,
  flagKey: string,
  date: string,
): Promise<FlagEvalRollup | null> {
  const obj = await bucket.get(flagEvalRollupKey(envId, flagKey, date));
  if (!obj) return null;
  return (await obj.json()) as FlagEvalRollup;
}

/**
 * Read a metric-event daily rollup from R2. Returns null if not found.
 */
export async function readMetricRollup(
  bucket: R2Bucket,
  envId: string,
  eventName: string,
  date: string,
): Promise<MetricEventRollup | null> {
  const obj = await bucket.get(metricEventRollupKey(envId, eventName, date));
  if (!obj) return null;
  return (await obj.json()) as MetricEventRollup;
}

/**
 * List all dates that have a flag-eval rollup for (envId, flagKey).
 * Returns a Set of "yyyy-MM-dd" strings. One R2 list call (paginated if >1000 rollups).
 */
export async function listFlagEvalRollupDates(
  bucket: R2Bucket,
  envId: string,
  flagKey: string,
): Promise<Set<string>> {
  const prefix = flagEvalRollupPrefix(envId, flagKey);
  const dates = new Set<string>();
  let cursor: string | undefined;
  do {
    const list = await bucket.list({ prefix, cursor });
    for (const obj of list.objects) {
      // key: rollups/flag-evals/<envId>/<flagKey>/yyyy-MM-dd.json
      const m = obj.key.match(/(\d{4}-\d{2}-\d{2})\.json$/);
      if (m) dates.add(m[1]);
    }
    cursor = list.truncated ? list.cursor : undefined;
  } while (cursor);
  return dates;
}

/**
 * List all dates that have a metric-event rollup for (envId, eventName).
 */
export async function listMetricRollupDates(
  bucket: R2Bucket,
  envId: string,
  eventName: string,
): Promise<Set<string>> {
  const prefix = metricEventRollupPrefix(envId, eventName);
  const dates = new Set<string>();
  let cursor: string | undefined;
  do {
    const list = await bucket.list({ prefix, cursor });
    for (const obj of list.objects) {
      const m = obj.key.match(/(\d{4}-\d{2}-\d{2})\.json$/);
      if (m) dates.add(m[1]);
    }
    cursor = list.truncated ? list.cursor : undefined;
  } while (cursor);
  return dates;
}

// ── Raw-data date discovery ───────────────────────────────────────────────────

/**
 * List all dates that have raw flag-eval segments for (envId, flagKey).
 * Uses R2 list with delimiter to get date "folders" in one call.
 */
export async function listFlagEvalRawDates(
  bucket: R2Bucket,
  envId: string,
  flagKey: string,
): Promise<Set<string>> {
  const prefix = `flag-evals/${sanitize(envId)}/${sanitize(flagKey)}/`;
  return listRawDates(bucket, prefix);
}

/**
 * List all dates that have raw metric-event segments for (envId, eventName).
 */
export async function listMetricRawDates(
  bucket: R2Bucket,
  envId: string,
  eventName: string,
): Promise<Set<string>> {
  const prefix = `metric-events/${sanitize(envId)}/${sanitize(eventName)}/`;
  return listRawDates(bucket, prefix);
}

async function listRawDates(
  bucket: R2Bucket,
  prefix: string,
): Promise<Set<string>> {
  const dates = new Set<string>();
  let cursor: string | undefined;
  do {
    const list = await bucket.list({ prefix, delimiter: "/", cursor });
    for (const dp of list.delimitedPrefixes) {
      // dp looks like "flag-evals/<envId>/<flagKey>/yyyy-MM-dd/"
      const dateStr = dp.slice(prefix.length, -1);
      if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
        dates.add(dateStr);
      }
    }
    cursor = list.truncated ? list.cursor : undefined;
  } while (cursor);
  return dates;
}
