/**
 * collect.ts — worker entry point
 *
 * DB-driven: fetches all running experiments from the API, then for each one:
 *   1. Resolves the adapter (mock override or FeatBit PG query)
 *   2. Assembles FetchParams from Project + Experiment DB fields
 *   3. Calls the adapter → gets either binary {n,k} or continuous {n,mean,variance,total}
 *   4. Writes the metric summary back to Experiment.inputData in DB
 *
 * No experiment needs to be listed in datasource.config.ts unless it needs
 * a mock adapter. All running experiments are picked up automatically from
 * the database.
 *
 * Run:
 *   npx tsx collect.ts
 *
 * Environment:
 *   SYNC_API_URL   — web app base URL (default: http://localhost:3000)
 *   FEATBIT_PG_URL — FeatBit PostgreSQL connection string (required for live adapter)
 */

import { configs, buildFetch } from "./datasource.config.js";
import type {
  FetchParams,
  MetricSummary,
  MetricType,
  MetricAgg,
} from "./src/adapters/interface.js";
import {
  isBinaryVariant as isBinary,
} from "./src/adapters/interface.js";

const API_BASE = process.env.SYNC_API_URL ?? "http://localhost:3000";

// ── Types (mirrors DB schema) ─────────────────────────────────────────────────

interface ProjectSnapshot {
  id: string;
  flagKey: string | null;
  envSecret: string | null;
}

interface RunningExperiment {
  id: string;
  projectId: string;
  slug: string;
  status: string;
  experimentId: string | null;
  primaryMetricEvent: string | null;
  primaryMetricType: string | null;
  primaryMetricAgg: string | null;
  controlVariant: string | null;
  treatmentVariant: string | null;
  observationStart: string | null;
  observationEnd: string | null;
  project: ProjectSnapshot;
}

// ── HTTP helpers ──────────────────────────────────────────────────────────────

async function apiGet<T>(path: string): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`);
  if (!res.ok) throw new Error(`GET ${path} → ${res.status}`);
  return res.json() as Promise<T>;
}

async function apiPost<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`POST ${path} → ${res.status}: ${text}`);
  }
  return res.json() as Promise<T>;
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`[worker] starting collect — ${new Date().toISOString()}`);
  console.log(`[worker] API_BASE = ${API_BASE}`);

  // 1. Fetch all running experiments from DB (single request)
  let experiments: RunningExperiment[];
  try {
    experiments = await apiGet<RunningExperiment[]>("/api/experiments/running");
  } catch (err) {
    console.error(`[worker] fatal: could not fetch running experiments: ${err}`);
    process.exit(1);
  }

  console.log(`[worker] ${experiments.length} running experiment(s) found in DB`);
  console.log(`[worker] ${configs.length} experiment(s) with overrides in datasource.config.ts\n`);

  // 2. Build a lookup map from datasource.config.ts (slug → config)
  //    Config is optional — only needed for mock data or customProperties overrides.
  const configBySlug = new Map(configs.map(c => [c.slug, c]));

  // 3. Process each experiment
  for (const exp of experiments) {
    console.log(`── [${exp.slug}] ──────────────────────────────────`);

    const { project } = exp;
    const config = configBySlug.get(exp.slug);

    // Determine adapter: use config if present, otherwise default to "featbit"
    const adapterType = config?.adapter ?? "featbit";

    // Build FetchParams from DB fields
    const now = new Date().toISOString().split("T")[0];
    const params: FetchParams = {
      envId:            project.envSecret        ?? "",
      flagKey:          project.flagKey           ?? "",
      experimentId:     exp.experimentId          ?? exp.slug,
      controlVariant:   exp.controlVariant        ?? "false",
      treatmentVariant: exp.treatmentVariant      ?? "true",
      metricEvent:      exp.primaryMetricEvent    ?? "",
      metricType:       (exp.primaryMetricType    ?? "binary") as MetricType,
      metricAgg:        (exp.primaryMetricAgg     ?? "once") as MetricAgg,
      start:            exp.observationStart?.split("T")[0] ?? now,
      end:              exp.observationEnd?.split("T")[0]   ?? now,
    };

    // Warn if required fields are missing (only relevant for featbit adapter)
    if (adapterType === "featbit") {
      const missing = (["envId", "flagKey", "experimentId", "metricEvent"] as const)
        .filter(k => !params[k]);
      if (missing.length > 0) {
        console.error(`  ✗ missing required DB fields: ${missing.join(", ")}`);
        console.error(`    Set them on the Project/Experiment record in the web UI, then re-run.`);
        continue;
      }
      if (!process.env.FEATBIT_PG_URL) {
        console.error(`  ✗ FEATBIT_PG_URL env var is required for the FeatBit adapter`);
        continue;
      }
    }

    // Resolve the fetch function
    let fetchFn: (p: FetchParams) => Promise<MetricSummary>;
    if (config) {
      fetchFn = buildFetch(config);
    } else {
      const { featbitFetch } = await import("./src/adapters/featbit.js");
      fetchFn = featbitFetch;
    }

    // Fetch metric data
    let summary: MetricSummary;
    try {
      summary = await fetchFn(params);
      // Log differently based on metric type
      if (isBinary(summary.control)) {
        const c = summary.control;
        const t = summary.treatment as typeof c;
        console.log(`  ✓ [binary]  control n=${c.n} k=${c.k}  |  treatment n=${t.n} k=${t.k}`);
      } else {
        const c = summary.control;
        const t = summary.treatment as typeof c;
        console.log(`  ✓ [${summary.metricType}]  control n=${c.n} mean=${c.mean.toFixed(2)}  |  treatment n=${t.n} mean=${t.mean.toFixed(2)}`);
      }
    } catch (err) {
      console.error(`  ✗ adapter error: ${err}`);
      continue;
    }

    // Write inputData back to DB
    const inputData = {
      collectedAt: new Date().toISOString(),
      source: adapterType,
      metricType: summary.metricType,
      control:   summary.control,
      treatment: summary.treatment,
    };

    try {
      await apiPost(
        `/api/projects/${encodeURIComponent(exp.projectId)}/experiment`,
        { slug: exp.slug, inputData: JSON.stringify(inputData) }
      );
      console.log(`  ✓ inputData written to DB`);
    } catch (err) {
      console.error(`  ✗ failed to write inputData: ${err}`);
    }
  }

  console.log(`\n[worker] collect complete — ${new Date().toISOString()}`);
}

main().catch(err => {
  console.error("[worker] fatal:", err);
  process.exit(1);
});
