/**
 * track-service HTTP client.
 *
 * Queries track-service's /api/query/experiment endpoint to get per-variant
 * aggregated stats from ClickHouse, then converts the response into the
 * metrics dict format that runAnalysis() / runBanditAnalysis() expect.
 */

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
}

/**
 * Query one metric event from track-service and return a per-variant data dict
 * in the shape expected by runAnalysis():
 *
 *   { "control": { n: 1000, k: 150 }, "treatment": { n: 1020, k: 204 } }
 *
 * For continuous metrics (sumValue > 0), returns:
 *   { "control": { n: 1000, sum: 5000, sum_squares: 27500 }, ... }
 *
 * Returns null if the query fails or no data is found.
 */
export async function queryMetric(
  params: QueryParams,
): Promise<Record<string, Record<string, number>> | null> {
  try {
    const resp = await fetch(`${TRACK_SERVICE_URL}/api/query/experiment`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        envId:       params.envId,
        flagKey:     params.flagKey,
        metricEvent: params.metricEvent,
        startDate:   params.startDate,
        endDate:     params.endDate,
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

    // Convert TrackVariantStats[] → { variant: { n, k } | { n, sum, sum_squares } }
    const result: Record<string, Record<string, number>> = {};
    for (const v of data.variants) {
      if (v.sumValue > 0 || v.sumSquares > 0) {
        // Continuous metric
        result[v.variant] = {
          n:            v.users,
          sum:          v.sumValue,
          sum_squares:  v.sumSquares,
        };
      } else {
        // Binary / proportion metric
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
 * Query primary metric + guardrails in parallel and return the full metrics
 * dict ready for runAnalysis():
 *
 *   {
 *     "checkout":    { "control": {n, k}, "treatment": {n, k} },
 *     "error_rate":  { "control": {n, k}, "treatment": {n, k}, "inverse": true },
 *   }
 */
export async function queryAllMetrics(params: {
  envId: string;
  flagKey: string;
  startDate: string;
  endDate: string;
  primaryMetricEvent: string;
  guardrailEvents?: string[];
}): Promise<Record<string, Record<string, unknown>> | null> {
  const events = [
    params.primaryMetricEvent,
    ...(params.guardrailEvents ?? []),
  ];

  const results = await Promise.all(
    events.map((metricEvent) =>
      queryMetric({
        envId:       params.envId,
        flagKey:     params.flagKey,
        metricEvent,
        startDate:   params.startDate,
        endDate:     params.endDate,
      }),
    ),
  );

  // Primary metric is required
  if (!results[0]) return null;

  const metrics: Record<string, Record<string, unknown>> = {};
  for (let i = 0; i < events.length; i++) {
    if (results[i]) {
      metrics[events[i]] = results[i] as Record<string, unknown>;
    }
  }

  return metrics;
}
