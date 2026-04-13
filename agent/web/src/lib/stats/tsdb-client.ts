/**
 * TSDB HTTP client — queries experiment metric data.
 *
 * TypeScript port of agent/data/Services/MetricCollector.cs.
 * Calls the TSDB service (tsdb.featbit.ai) to collect aggregated
 * variant statistics for Bayesian analysis.
 */

import type {
  MetricSummary,
  TsdbManyQueryResponse,
  TsdbQueryResponse,
} from "./types";

const TSDB_BASE_URL =
  process.env.TSDB_BASE_URL ?? "https://tsdb.featbit.ai";

const TSDB_TIMEOUT_MS = Number(process.env.TSDB_TIMEOUT_MS ?? 8000);
const TSDB_MAX_RETRIES = Number(process.env.TSDB_MAX_RETRIES ?? 2);
const TSDB_RETRY_BASE_MS = Number(process.env.TSDB_RETRY_BASE_MS ?? 250);

export interface CollectParams {
  envId: string;
  flagKey: string;
  metricEvent: string;
  metricType: string;
  metricAgg: string;
  controlVariant: string;
  treatmentVariant: string;
  start: string; // ISO-8601
  end: string;   // ISO-8601
  experimentId?: string;
  layerId?: string;
  trafficPercent?: number;
  trafficOffset?: number;
  audienceFilters?: string;
  method?: string;
}

export interface CollectManyParams extends CollectParams {
  guardrailEvents?: string[];
}

/**
 * Query TSDB for experiment metric data and return a MetricSummary.
 */
export async function collectMetric(
  params: CollectParams,
): Promise<MetricSummary | null> {
  const result = await postWithRetry<TsdbQueryResponse>(
    "/api/query/experiment",
    buildRequestBody(params),
    params.envId,
  );

  return result ? mapToMetricSummary(result, params) : null;
}

export async function collectManyMetrics(
  params: CollectManyParams,
): Promise<Record<string, MetricSummary> | null> {
  const result = await postWithRetry<TsdbManyQueryResponse>(
    "/api/query/experiment-many",
    {
      ...buildRequestBody(params),
      guardrailEvents: params.guardrailEvents ?? [],
    },
    params.envId,
  );

  if (!result) {
    return null;
  }

  const summaries: Record<string, MetricSummary> = {
    [params.metricEvent]: mapToMetricSummary(result[params.metricEvent], params),
  };

  for (const guardrailEvent of params.guardrailEvents ?? []) {
    const guardrailResult = result[guardrailEvent];
    if (!guardrailResult) {
      continue;
    }

    summaries[guardrailEvent] = mapToMetricSummary(guardrailResult, {
      ...params,
      metricEvent: guardrailEvent,
      metricType: "binary",
      metricAgg: "once",
    });
  }

  return summaries;
}

function buildRequestBody(params: CollectParams) {
  return {
    envId: params.envId,
    flagKey: params.flagKey,
    metricEvent: params.metricEvent,
    metricType: params.metricType,
    metricAgg: params.metricAgg,
    controlVariant: params.controlVariant,
    treatmentVariant: params.treatmentVariant,
    start: params.start,
    end: params.end,
    experimentId: params.experimentId,
    layerId: params.layerId,
    trafficPercent: params.trafficPercent ?? 100,
    trafficOffset: params.trafficOffset ?? 0,
    audienceFilters: params.audienceFilters,
    method: params.method ?? "bayesian_ab",
  };
}

async function postWithRetry<T>(
  path: string,
  body: unknown,
  envId: string,
): Promise<T | null> {
  for (let attempt = 0; attempt <= TSDB_MAX_RETRIES; attempt += 1) {
    const timeout = AbortSignal.timeout(TSDB_TIMEOUT_MS);
    try {
      const resp = await fetch(`${TSDB_BASE_URL}${path}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: envId,
        },
        body: JSON.stringify(body),
        signal: timeout,
      });

      if (resp.ok) {
        return (await resp.json()) as T;
      }

      const shouldRetry =
        resp.status === 429 || resp.status === 502 || resp.status === 503 || resp.status === 504 || resp.status >= 500;

      console.warn(
        `[tsdb-client] TSDB query failed (attempt ${attempt + 1}/${TSDB_MAX_RETRIES + 1}): ${resp.status} ${resp.statusText}`,
      );

      if (!shouldRetry || attempt === TSDB_MAX_RETRIES) {
        return null;
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(
        `[tsdb-client] TSDB query error (attempt ${attempt + 1}/${TSDB_MAX_RETRIES + 1}): ${message}`,
      );

      if (attempt === TSDB_MAX_RETRIES) {
        return null;
      }
    }

    const backoff = TSDB_RETRY_BASE_MS * (attempt + 1);
    await new Promise((resolve) => setTimeout(resolve, backoff));
  }

  return null;
}

function mapToMetricSummary(
  result: TsdbQueryResponse,
  params: CollectParams,
): MetricSummary {
  const ctrl = result.variants[params.controlVariant];
  const trt = result.variants[params.treatmentVariant];

  if (result.metricType === "binary") {
    return {
      metricType: "binary",
      control: { n: ctrl?.n ?? 0, k: ctrl?.k ?? 0 },
      treatment: { n: trt?.n ?? 0, k: trt?.k ?? 0 },
    };
  }

  return {
    metricType: result.metricType,
    control: {
      n: ctrl?.n ?? 0,
      mean: ctrl?.mean ?? 0,
      variance: ctrl?.variance ?? 0,
      total: ctrl?.total ?? 0,
    },
    treatment: {
      n: trt?.n ?? 0,
      mean: trt?.mean ?? 0,
      variance: trt?.variance ?? 0,
      total: trt?.total ?? 0,
    },
  };
}
