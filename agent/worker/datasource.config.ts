import type { FetchMetricSummary, VariantSummary } from "./src/adapters/interface.js";
import { makeMockFetch } from "./src/adapters/mock.js";
import { featbitFetch } from "./src/adapters/featbit.js";

/**
 * datasource.config.ts — per-experiment data source configuration.
 *
 * HOW TO USE:
 *
 *   - Set `adapter: "mock"` to use hardcoded data (no FeatBit connection needed).
 *     Fill in `mockData` with realistic values matching the metric type:
 *       binary:     { n, k }
 *       continuous: { n, mean, variance, total }
 *
 *   - Set `adapter: "featbit"` to query FeatBit's PostgreSQL event tables.
 *     Requires env var FEATBIT_PG_URL and experiment_id stain in the DB.
 *
 *   - The experiment `slug` must match the slug stored in the Experiment table.
 *
 *   - Experiments that are NOT listed here will default to "featbit" adapter.
 */

export interface ExperimentDataSourceConfig {
  /** Must match Experiment.slug in the database */
  slug: string;

  /** Which adapter to use for this experiment */
  adapter: "mock" | "featbit";

  /**
   * Static data returned by mock adapter.
   * Required when adapter = "mock".
   * Shape must match the experiment's metricType:
   *   binary:     { n: number, k: number }
   *   continuous: { n: number, mean: number, variance: number, total: number }
   */
  mockData?: {
    control:   VariantSummary;
    treatment: VariantSummary;
  };
}

// ── Configuration ─────────────────────────────────────────────────────────────

export const configs: ExperimentDataSourceConfig[] = [
  {
    // Binary metric example — mock data until FeatBit PG is connected
    slug: "chat-cta-v2",
    adapter: "mock",
    mockData: {
      control:   { n: 1200, k: 54 },
      treatment: { n: 1180, k: 79 },
    },
  },

  {
    // Worker test experiment — seeded by prisma/seed-worker-test.ts
    slug: "onboarding-checklist-v1",
    adapter: "mock",
    mockData: {
      control:   { n: 420, k: 134 },
      treatment: { n: 415, k: 187 },
    },
  },

  // Example: continuous metric (revenue per user)
  // {
  //   slug: "pricing-page-v3",
  //   adapter: "mock",
  //   mockData: {
  //     control:   { n: 500, mean: 42.5,  variance: 312.0, total: 21250 },
  //     treatment: { n: 490, mean: 51.2,  variance: 408.5, total: 25088 },
  //   },
  // },
];

// ── Factory ───────────────────────────────────────────────────────────────────

export function buildFetch(config: ExperimentDataSourceConfig): FetchMetricSummary {
  if (config.adapter === "mock") {
    if (!config.mockData) {
      throw new Error(`Experiment "${config.slug}": adapter is "mock" but mockData is not set.`);
    }
    return makeMockFetch(config.mockData.control, config.mockData.treatment);
  }

  if (config.adapter === "featbit") {
    return featbitFetch;
  }

  throw new Error(`Unknown adapter type: ${(config as ExperimentDataSourceConfig).adapter}`);
}
