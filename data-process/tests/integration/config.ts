/**
 * Integration test configuration.
 *
 * Adjust WORKER_URL to point at your local wrangler dev instance.
 * R2 credentials are read from environment variables (same as rollup-service).
 */

export const CFG = {
  // cf-worker base URL (npx wrangler dev --remote)
  workerUrl: process.env.WORKER_URL ?? "http://localhost:8787",

  // Experiment parameters
  envId:       "env-inttest-001",
  flagKey:     "pricing-v2",
  metricEvent: "checkout",
  experimentId: "exp-001",
  layerId:     null as string | null,

  // Population
  userCount:         1_000,   // total synthetic users
  conversionRate:    0.3,     // 30% of variant-B users convert
  baseConversionRate: 0.2,    // 20% of control (variant-A) users convert

  // Variants: hash bucket 0–49 → "off", 50–99 → "on"
  variantA: "off",
  variantB: "on",

  // Tolerance for assertion (allow ±2%)
  tolerance: 0.02,

  // Batch size when posting to /api/track
  batchSize: 500,

  // R2 credentials (for benchmark only; integration test uses cf-worker)
  r2: {
    accountId:   process.env.R2_ACCOUNT_ID        ?? "",
    accessKeyId: process.env.R2_ACCESS_KEY_ID     ?? "",
    secretKey:   process.env.R2_SECRET_ACCESS_KEY ?? "",
    bucketName:  "featbit-tsdb",
  },

  // Path to rollup-service binary (dotnet run or compiled exe)
  rollupServiceDir: "../../rollup-service",
};
