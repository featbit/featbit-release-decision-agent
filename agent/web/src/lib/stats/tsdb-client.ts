/**
 * TSDB HTTP client — queries experiment metric data.
 *
 * TypeScript port of agent/data/Services/MetricCollector.cs.
 * Calls the TSDB service (tsdb.featbit.ai) to collect aggregated
 * variant statistics for Bayesian analysis.
 */

import type { MetricSummary, TsdbQueryResponse } from "./types";

const TSDB_BASE_URL =
  process.env.TSDB_BASE_URL ?? "https://tsdb.featbit.ai";

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

/**
 * Query TSDB for experiment metric data and return a MetricSummary.
 */
export async function collectMetric(
  params: CollectParams,
): Promise<MetricSummary | null> {
  const body = {
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

  const resp = await fetch(`${TSDB_BASE_URL}/api/query/experiment`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: params.envId,
    },
    body: JSON.stringify(body),
  });

  if (!resp.ok) {
    console.error(
      `[tsdb-client] TSDB query failed: ${resp.status} ${resp.statusText}`,
    );
    return null;
  }

  const result: TsdbQueryResponse = await resp.json();
  return mapToMetricSummary(result, params);
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
