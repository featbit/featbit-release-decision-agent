/**
 * Orchestrates the full experiment metric query.
 *
 * Execution plan (mirrors .NET ExperimentQueryEngine):
 *
 *  Step 1 — Build exposure map
 *    Scan flag-eval segments for (envId, flagKey, time range).
 *    Apply: variant filter, experiment_id, layer_id, traffic bucket, audience.
 *    Keep first evaluation per user (min timestamp).
 *
 *  Step 2 — Balance variants (bayesian_ab only)
 *    Downsample over-represented variants to min(n_control, n_treatment).
 *
 *  Step 3 — Aggregate metric events
 *    Scan metric-event segments, join on user_key in exposure map.
 *    Per-user aggregation, then per-variant statistics.
 */

import type {
  ExperimentQuery,
  ExperimentQueryResponse,
  VariantStatsDto,
} from "../models/dtos";
import { buildExposureMap, balanceExposureMap } from "./flag-eval-scanner";
import { aggregateMetricEvents } from "./metric-event-scanner";

/**
 * Execute a single metric query and return aggregated statistics.
 */
export async function queryExperiment(
  bucket: R2Bucket,
  query: ExperimentQuery,
): Promise<ExperimentQueryResponse> {
  // Step 1: Build exposure map.
  const exposureMap = await buildExposureMap(bucket, query);

  if (exposureMap.size === 0) return emptyResult(query);

  // Step 2: Balance variants (bayesian_ab only).
  balanceExposureMap(exposureMap, query);

  if (exposureMap.size === 0) return emptyResult(query);

  // Step 3: Aggregate metric events.
  return aggregateMetricEvents(bucket, query, exposureMap);
}

/**
 * Execute queries for a primary metric and zero or more guardrail metrics.
 * The exposure map is built once and shared across all metric queries.
 */
export async function queryMany(
  bucket: R2Bucket,
  primaryQuery: ExperimentQuery,
  guardrailEventNames?: string[],
): Promise<Record<string, ExperimentQueryResponse>> {
  // Build and balance exposure map once.
  const exposureMap = await buildExposureMap(bucket, primaryQuery);
  balanceExposureMap(exposureMap, primaryQuery);

  if (exposureMap.size === 0) {
    const empty: Record<string, ExperimentQueryResponse> = {
      [primaryQuery.metricEvent]: emptyResult(primaryQuery),
    };
    if (guardrailEventNames) {
      for (const g of guardrailEventNames) {
        empty[g] = emptyResult(guardrailQuery(primaryQuery, g));
      }
    }
    return empty;
  }

  // Build all metric queries sharing the same exposure map.
  const allMetrics: Array<{ event: string; q: ExperimentQuery }> = [
    { event: primaryQuery.metricEvent, q: primaryQuery },
  ];

  if (guardrailEventNames) {
    for (const g of guardrailEventNames) {
      allMetrics.push({ event: g, q: guardrailQuery(primaryQuery, g) });
    }
  }

  // Scan all metric event tables in parallel.
  const results = await Promise.all(
    allMetrics.map(async (m) => {
      const result = await aggregateMetricEvents(bucket, m.q, exposureMap);
      return { event: m.event, result };
    }),
  );

  const out: Record<string, ExperimentQueryResponse> = {};
  for (const r of results) {
    out[r.event] = r.result;
  }
  return out;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function guardrailQuery(src: ExperimentQuery, eventName: string): ExperimentQuery {
  return {
    ...src,
    metricEvent: eventName,
    metricType: "binary",
    metricAgg: "once",
  };
}

function emptyResult(query: ExperimentQuery): ExperimentQueryResponse {
  const zero: VariantStatsDto =
    query.metricType === "binary"
      ? { n: 0, k: 0 }
      : { n: 0, mean: 0, variance: 0, total: 0 };

  const variants: Record<string, VariantStatsDto> = {};
  for (const v of query.allVariants) {
    variants[v] = zero;
  }
  return { metricType: query.metricType, variants };
}
