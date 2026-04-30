/**
 * track-service HTTP client.
 *
 * Queries track-service's /api/query/experiment endpoint to get per-variant
 * aggregated stats from ClickHouse, then converts the response into the
 * metrics dict format that runAnalysis() / runBanditAnalysis() expect.
 */

import { signEnvSecret } from "@/lib/track/env-secret";

const TRACK_SERVICE_URL =
  process.env.TRACK_SERVICE_URL ?? "https://track.featbit.ai";

const TIMEOUT_MS = Number(process.env.TRACK_TIMEOUT_MS ?? 10000);

// ── Track-service response shape ──────────────────────────────────────────────

interface TrackVariantStats {
  variant: string;
  users: number;
  conversions: number;
  sumValue: number;
  sumSquares: number;
  conversionRate: number;
  avgValue: number;
}

interface TrackQueryResponse {
  envId: string;
  flagKey: string;
  metricEvent: string;
  window: { start: string; end: string };
  variants: TrackVariantStats[];
}

// ── Public API ────────────────────────────────────────────────────────────────

export interface QueryParams {
  envId: string;
  flagKey: string;
  metricEvent: string;
  startDate: string; // YYYY-MM-DD
  endDate: string;   // YYYY-MM-DD
  /**
   * Canonical "binary" | "continuous". When provided, track-client uses it
   * to pick the {n,k} vs {n,sum,sum_squares} response shape directly,
   * skipping the legacy heuristic. Track-service receives it too so its
   * SQL aggregates per the user's declared aggregation.
   */
  metricType?: string;
  /**
   * Canonical "once" | "count" | "sum" | "average". Forwarded to
   * track-service so the per-user contribution column matches the user's
   * declared aggregation (binary=once, continuous=count|sum|average).
   */
  metricAgg?: string;
}

/**
 * Query one metric event from track-service and return a per-variant data dict
 * in the shape expected by runAnalysis():
 *
 *   binary     → { "control": { n: 1000, k: 150 }, ... }
 *   continuous → { "control": { n: 1000, sum: 5000, sum_squares: 27500 }, ... }
 *
 * The shape is decided by `metricType` when provided; otherwise a heuristic
 * on (sumValue, conversions) picks the most plausible shape — kept only as a
 * fallback for legacy callers that don't yet know the metric type.
 *
 * Returns null if the query fails or no data is found.
 */
export async function queryMetric(
  params: QueryParams,
): Promise<Record<string, Record<string, number>> | null> {
  try {
    const resp = await fetch(`${TRACK_SERVICE_URL}/api/query/experiment`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        // Signed env secret — track-service resolves envId from this token.
        // Falls back to raw envId when TRACK_SERVICE_SIGNING_KEY is unset.
        Authorization: signEnvSecret(params.envId),
      },
      body: JSON.stringify({
        flagKey:     params.flagKey,
        metricEvent: params.metricEvent,
        startDate:   params.startDate,
        endDate:     params.endDate,
        ...(params.metricType && { metricType: params.metricType }),
        ...(params.metricAgg  && { metricAgg:  params.metricAgg  }),
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });

    if (!resp.ok) {
      console.warn(
        `[track-client] query failed: ${resp.status} ${resp.statusText}`,
      );
      return null;
    }

    const data = (await resp.json()) as TrackQueryResponse;
    // Success with zero rows is NOT the same as a query failure.
    // Return an empty object so callers can distinguish "no data yet" from
    // "track-service unreachable" (which returns null via the catch below).
    if (!data.variants || data.variants.length === 0) return {};

    // Decide the per-variant shape:
    //   1. If metricType is declared, trust it. Single source of truth.
    //   2. Otherwise fall back to the legacy heuristic on (sumValue, conversions).
    //      Kept for callers that don't yet know the metric type — e.g. external
    //      tooling or experiments saved before the vocabulary was unified.
    const declaredBinary     = params.metricType === "binary";
    const declaredContinuous = params.metricType === "continuous";

    const result: Record<string, Record<string, number>> = {};
    for (const v of data.variants) {
      const isContinuous = declaredContinuous || (
        !declaredBinary &&
        (v.sumValue > 0 || v.sumSquares > 0) &&
        v.sumValue > v.conversions + 0.001
      );
      if (isContinuous) {
        // Continuous metric (e.g. revenue, load time)
        result[v.variant] = {
          n:            v.users,
          sum:          v.sumValue,
          sum_squares:  v.sumSquares,
        };
      } else {
        // Binary / proportion metric (e.g. click, signup, checkout)
        result[v.variant] = {
          n: v.users,
          k: v.conversions,
        };
      }
    }

    return result;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`[track-client] query error: ${message}`);
    return null;
  }
}

/**
 * Per-event spec consumed by queryAllMetrics. Carries the user's declared
 * metricType / metricAgg so each query honours the right SQL aggregation
 * (track-service side) and response shape (track-client side).
 */
export interface MetricSpec {
  event: string;
  metricType?: string;   // canonical: "binary" | "continuous"
  metricAgg?: string;    // canonical: "once" | "count" | "sum" | "average"
}

/**
 * Query primary metric + guardrails in parallel and return the full metrics
 * dict ready for runAnalysis():
 *
 *   {
 *     "checkout":    { "control": {n, k}, "treatment": {n, k} },
 *     "error_rate":  { "control": {n, k}, "treatment": {n, k}, "inverse": true },
 *   }
 *
 * Pass MetricSpec[] (preferred) so each metric carries its declared type/agg.
 * The legacy `primaryMetricEvent` + `guardrailEvents` string args still work
 * for back-compat with callers that haven't migrated yet.
 */
export async function queryAllMetrics(params: {
  envId: string;
  flagKey: string;
  startDate: string;
  endDate: string;
  /** Preferred: rich primary spec with type/agg. */
  primary?: MetricSpec;
  /** Preferred: rich guardrail specs with type/agg per metric. */
  guardrails?: MetricSpec[];
  /** @deprecated Pass `primary` instead. */
  primaryMetricEvent?: string;
  /** @deprecated Pass `guardrails` instead. */
  guardrailEvents?: string[];
}): Promise<Record<string, Record<string, unknown>> | null> {
  // Resolve the preferred MetricSpec inputs, falling back to the legacy
  // string-only args. New callers should always pass primary + guardrails.
  const primarySpec: MetricSpec | null =
    params.primary
      ?? (params.primaryMetricEvent ? { event: params.primaryMetricEvent } : null);
  const guardrailSpecs: MetricSpec[] =
    params.guardrails
      ?? (params.guardrailEvents ?? []).map((event) => ({ event }));

  if (!primarySpec) return null;
  const specs: MetricSpec[] = [primarySpec, ...guardrailSpecs];

  const results = await Promise.all(
    specs.map((spec) =>
      queryMetric({
        envId:       params.envId,
        flagKey:     params.flagKey,
        metricEvent: spec.event,
        startDate:   params.startDate,
        endDate:     params.endDate,
        metricType:  spec.metricType,
        metricAgg:   spec.metricAgg,
      }),
    ),
  );

  // Primary metric is required
  if (!results[0]) return null;

  const metrics: Record<string, Record<string, unknown>> = {};
  for (let i = 0; i < specs.length; i++) {
    if (results[i]) {
      metrics[specs[i].event] = results[i] as Record<string, unknown>;
    }
  }

  return metrics;
}
