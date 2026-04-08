import type {
  FetchMetricSummary,
  MetricSummary,
  VariantSummary,
} from "./interface.js";

/**
 * makeMockFetch — returns a fetch function with hardcoded data.
 *
 * Supports both binary { n, k } and continuous { n, mean, variance, total } shapes.
 * The static data is configured in datasource.config.ts per experiment slug.
 */
export function makeMockFetch(
  control: VariantSummary,
  treatment: VariantSummary
): FetchMetricSummary {
  return async (params): Promise<MetricSummary> => {
    console.log("[mock] returning static data");
    return {
      metricType: params.metricType,
      control,
      treatment,
    };
  };
}
