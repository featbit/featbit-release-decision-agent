/**
 * Daily rollup storage format.
 *
 * Rollups are pre-computed per-user aggregates stored as JSON in R2.
 * They eliminate the need to scan many raw .fbs segments for cold days,
 * reducing R2 read operations and query latency for long time ranges.
 *
 * R2 paths:
 *   rollups/flag-evals/{envId}/{flagKey}/{yyyy-MM-dd}.json
 *   rollups/metric-events/{envId}/{eventName}/{yyyy-MM-dd}.json
 */

/**
 * Flag-eval rollup entry.
 * Tuple: [firstExposedAt, variant, experimentId, layerId, hashBucket]
 */
export type FlagEvalRollupEntry = [
  number,         // firstExposedAt (unix ms)
  string,         // variant
  string | null,  // experimentId
  string | null,  // layerId
  number,         // hashBucket (0-255)
];

export interface FlagEvalRollup {
  v: 1;
  /** userKey → FlagEvalRollupEntry */
  u: Record<string, FlagEvalRollupEntry>;
}

/**
 * Metric-event rollup entry.
 * Tuple: [hasConversion, firstTs, firstValue, latestTs, latestValue, sum, count]
 */
export type MetricRollupEntry = [
  number,         // hasConversion (0 or 1)
  number,         // firstTs (unix ms)
  number | null,  // firstValue
  number,         // latestTs (unix ms)
  number | null,  // latestValue
  number,         // sum
  number,         // count
];

export interface MetricEventRollup {
  v: 1;
  /** userKey → MetricRollupEntry */
  u: Record<string, MetricRollupEntry>;
}
