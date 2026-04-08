/**
 * Shared types for data source adapters.
 *
 * Two metric shapes:
 *   binary     — { n, k }            (exposed, converted)
 *   continuous — { n, mean, variance, total } (per-user aggregated value)
 */

// ── Variant-level summaries ────────────────────────────────────────────────────

export interface BinaryVariant {
  n: number;        // unique users exposed
  k: number;        // unique users who converted
}

export interface ContinuousVariant {
  n: number;        // unique users exposed
  mean: number;     // mean of per-user aggregated value
  variance: number; // sample variance (VAR_SAMP)
  total: number;    // sum of per-user values (useful for revenue)
}

export type VariantSummary = BinaryVariant | ContinuousVariant;

// ── Metric summary ─────────────────────────────────────────────────────────────

export type MetricType = "binary" | "revenue" | "count" | "duration";
export type MetricAgg  = "once" | "sum" | "mean" | "count" | "latest";

export interface MetricSummary {
  metricType: MetricType;
  control:    VariantSummary;
  treatment:  VariantSummary;
}

// ── Type guards ────────────────────────────────────────────────────────────────

export function isBinaryVariant(v: VariantSummary): v is BinaryVariant {
  return "k" in v;
}

export function isContinuousVariant(v: VariantSummary): v is ContinuousVariant {
  return "mean" in v;
}

// ── Fetch parameters ───────────────────────────────────────────────────────────

/**
 * Parameters derived from the Project + Experiment DB records.
 * The worker assembles these before calling the adapter function.
 */
export interface FetchParams {
  // From Project
  envId: string;          // FeatBit environment ID
  flagKey: string;        // feature flag key

  // From Experiment
  experimentId: string;   // stain ID — matches flag_evaluations.experiment_id
  controlVariant: string;
  treatmentVariant: string;
  metricEvent: string;    // primaryMetricEvent
  metricType: MetricType; // binary | revenue | count | duration
  metricAgg: MetricAgg;   // once | sum | mean | count | latest
  start: string;          // ISO 8601 date, observationStart
  end: string;            // ISO 8601 date, observationEnd (or today if still running)
}

/**
 * An adapter is just a plain async function: params → MetricSummary.
 * No classes, no instances — pass it around directly.
 */
export type FetchMetricSummary = (params: FetchParams) => Promise<MetricSummary>;
