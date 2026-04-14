/**
 * Shared data format contracts between cf-worker (TypeScript) and rollup-service (.NET).
 *
 * cf-worker imports these directly.
 * rollup-service re-implements the same structures in C# (Models/RollupModels.cs).
 *
 * ANY change here must be mirrored in RollupModels.cs.
 */

// ── Delta format (written by PartitionWriterDO, read by rollup-service) ───────

/**
 * Stored at: deltas/flag-evals/{envId}/{flagKey}/{date}/{timestamp}.json
 *            deltas/metric-events/{envId}/{eventName}/{date}/{timestamp}.json
 */
export interface DeltaFile<T> {
  v: 1;
  u: Record<string, T>;
}

/** [timestamp, variant, experimentId|null, layerId|null, hashBucket] */
export type FlagEvalEntry = [number, string, string | null, string | null, number];

/** [hasConversion(0|1), firstTs, firstVal|null, latestTs, latestVal|null, sum, count] */
export type MetricEntry = [0 | 1, number, number | null, number, number | null, number, number];

// ── Rollup format (written by rollup-service, read by cf-worker query) ────────

/**
 * Stored at: rollups/flag-evals/{envId}/{flagKey}/{date}.json
 */
export interface FlagEvalRollup {
  v: 1;
  u: Record<string, FlagEvalEntry>;
}

/**
 * Stored at: rollups/metric-events/{envId}/{eventName}/{date}.json
 */
export interface MetricEventRollup {
  v: 1;
  u: Record<string, MetricEntry>;
}

// ── R2 path conventions (must match rollup-service DeltaProcessor.cs) ─────────

export const Paths = {
  flagEvalDelta:      (envId: string, flagKey: string,   date: string, ts: number) =>
    `deltas/flag-evals/${envId}/${flagKey}/${date}/${ts}.json`,

  metricEventDelta:   (envId: string, eventName: string, date: string, ts: number) =>
    `deltas/metric-events/${envId}/${eventName}/${date}/${ts}.json`,

  flagEvalRollup:     (envId: string, flagKey: string,   date: string) =>
    `rollups/flag-evals/${envId}/${flagKey}/${date}.json`,

  metricEventRollup:  (envId: string, eventName: string, date: string) =>
    `rollups/metric-events/${envId}/${eventName}/${date}.json`,
} as const;
