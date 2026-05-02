/**
 * Experiment-context-aware fetcher for Customer Managed Data Endpoints.
 *
 * Sits between `analyze/route.ts` and `customer-endpoint-client.ts`:
 *
 *   route.ts → fetcher.ts → client.ts
 *     ^             ^            ^
 *   "I have a    "translate    "raw HTTP +
 *    run row"     a run row     HMAC + retry"
 *                 to one or
 *                 more calls"
 *
 * Handles both spec routing modes (customer-single vs customer-per-metric),
 * loads providers from Prisma, fans out parallel calls when Mode B groups
 * metrics across multiple endpoints, and merges all responses into the
 * `MetricsDict` shape that the analyzer (`runAnalysis` / `runBanditAnalysis`)
 * already consumes — so the analyzer is unchanged regardless of data source.
 */

import { prisma } from "@/lib/prisma";
import {
  callCustomerEndpoint,
  type MetricSpec,
  type StatsResponse,
  type CallError,
} from "./customer-endpoint-client";

// ── MetricsDict — same shape the existing analyzer consumes ──────────────────

export type MetricsDict = Record<
  string,                                          // metric event name
  Record<string, Record<string, number>>           // variant → stats
>;

// ── Per-experiment routing config (parsed from ExperimentRun.customerEndpointConfig) ─

interface SingleEndpointConfig {
  providerId:    string;
  path:          string;
  staticParams?: Record<string, unknown>;
}

interface PerMetricEndpointConfig {
  [metricEvent: string]: {
    providerId:    string;
    path:          string;
    staticParams?: Record<string, unknown>;
  };
}

// ── Public types ─────────────────────────────────────────────────────────────

export interface FetchContext {
  experimentId:    string;
  flagKey:         string;
  envId:           string;
  variants:        string[];
  windowStart:     string;     // ISO-8601
  windowEnd:       string;     // ISO-8601
  experimentMode:  "ab" | "bandit";
  primary:         MetricSpec;
  guardrails:      MetricSpec[];   // empty for bandit
}

export type FetchResult =
  | { ok: true;  metrics: MetricsDict }
  | { ok: false; error: string };

/**
 * Fetch all metrics for a run from its configured Customer Managed Data
 * Endpoint(s). Returns the merged MetricsDict on success, or a human-readable
 * error string on failure (no fallback to other data sources — a
 * dataSourceMode choice is explicit).
 */
export async function fetchFromCustomerEndpoint(
  dataSourceMode:        string,
  customerEndpointConfig: string | null,
  ctx:                   FetchContext,
): Promise<FetchResult> {
  if (!customerEndpointConfig) {
    return { ok: false, error: "customerEndpointConfig is empty" };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(customerEndpointConfig);
  } catch (e) {
    return { ok: false, error: `customerEndpointConfig is not valid JSON: ${(e as Error).message}` };
  }

  const allMetrics = [ctx.primary, ...ctx.guardrails];

  if (dataSourceMode === "customer-single") {
    return fetchSingle(parsed as SingleEndpointConfig, allMetrics, ctx);
  }
  if (dataSourceMode === "customer-per-metric") {
    return fetchPerMetric(parsed as PerMetricEndpointConfig, allMetrics, ctx);
  }
  return { ok: false, error: `unsupported dataSourceMode: ${dataSourceMode}` };
}

// ── Mode A: single endpoint, all metrics in one call ─────────────────────────

async function fetchSingle(
  config:   SingleEndpointConfig,
  metrics:  MetricSpec[],
  ctx:      FetchContext,
): Promise<FetchResult> {
  if (!config.providerId || typeof config.path !== "string") {
    return { ok: false, error: "customer-single config missing providerId or path" };
  }
  const provider = await prisma.customerEndpointProvider.findUnique({
    where: { id: config.providerId },
  });
  if (!provider) {
    return { ok: false, error: `provider ${config.providerId} not found (deleted?)` };
  }

  const result = await callCustomerEndpoint(provider, config.path, {
    experimentMode: ctx.experimentMode,
    experimentId:   ctx.experimentId,
    flagKey:        ctx.flagKey,
    envId:          ctx.envId,
    variants:       ctx.variants,
    windowStart:    ctx.windowStart,
    windowEnd:      ctx.windowEnd,
    metrics,
    staticParams:   config.staticParams,
  });

  if (!result.ok) {
    return { ok: false, error: formatCallError(provider.name, result.error, result.attempts) };
  }
  return { ok: true, metrics: responseToMetricsDict(result.response) };
}

// ── Mode B: per-metric routing, fan out by (provider, path) ──────────────────

async function fetchPerMetric(
  config:   PerMetricEndpointConfig,
  metrics:  MetricSpec[],
  ctx:      FetchContext,
): Promise<FetchResult> {
  // Group metrics by (providerId, path) so co-located metrics share a call.
  type Group = {
    providerId:   string;
    path:         string;
    staticParams?: Record<string, unknown>;
    metrics:      MetricSpec[];
  };
  const groups = new Map<string, Group>();
  for (const m of metrics) {
    const route = config[m.name];
    if (!route || !route.providerId || typeof route.path !== "string") {
      return { ok: false, error: `customer-per-metric config missing route for metric "${m.name}"` };
    }
    const key = `${route.providerId}|${route.path}`;
    let g = groups.get(key);
    if (!g) {
      g = { providerId: route.providerId, path: route.path, staticParams: route.staticParams, metrics: [] };
      groups.set(key, g);
    }
    g.metrics.push(m);
  }

  // Load all distinct providers in one query.
  const providerIds = [...new Set([...groups.values()].map((g) => g.providerId))];
  const providers = await prisma.customerEndpointProvider.findMany({
    where: { id: { in: providerIds } },
  });
  const providerById = new Map(providers.map((p) => [p.id, p]));
  for (const id of providerIds) {
    if (!providerById.has(id)) {
      return { ok: false, error: `provider ${id} not found (deleted?)` };
    }
  }

  // Fire all calls in parallel.
  const groupList = [...groups.values()];
  const calls = groupList.map((g) =>
    callCustomerEndpoint(providerById.get(g.providerId)!, g.path, {
      experimentMode: ctx.experimentMode,
      experimentId:   ctx.experimentId,
      flagKey:        ctx.flagKey,
      envId:          ctx.envId,
      variants:       ctx.variants,
      windowStart:    ctx.windowStart,
      windowEnd:      ctx.windowEnd,
      metrics:        g.metrics,
      staticParams:   g.staticParams,
    }),
  );
  const results = await Promise.all(calls);

  // Merge. Any single failure aborts — partial results would silently mask
  // missing guardrails, which matters more than getting some data fast.
  const merged: MetricsDict = {};
  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    if (!r.ok) {
      const provName = providerById.get(groupList[i].providerId)!.name;
      return { ok: false, error: formatCallError(provName, r.error, r.attempts) };
    }
    Object.assign(merged, responseToMetricsDict(r.response));
  }
  return { ok: true, metrics: merged };
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function responseToMetricsDict(response: StatsResponse): MetricsDict {
  const out: MetricsDict = {};
  for (const [name, block] of Object.entries(response.metrics)) {
    const data: Record<string, Record<string, number>> = {};
    for (const [variant, stats] of Object.entries(block.data)) {
      // metricMoments() in bayesian.ts:51-53 reads either {n, k} or
      // {n, mean, variance} natively; normaliseResponse already converted
      // {n, mean, stddev} → {n, mean, variance}. Cast through Record<...>
      // because the analyzer's MetricsDict is intentionally untyped at the
      // leaves (legacy contract).
      data[variant] = stats as unknown as Record<string, number>;
    }
    out[name] = data;
  }
  return out;
}

function formatCallError(providerName: string, err: CallError, attempts: number): string {
  const parts = [`provider "${providerName}"`, err.kind];
  if (err.status) parts.push(`HTTP ${err.status}`);
  parts.push(err.message);
  if (attempts > 1) parts.push(`(${attempts} attempts)`);
  return parts.join(" — ");
}
