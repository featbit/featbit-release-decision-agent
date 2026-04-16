/**
 * Canary experiment constants — kept in sync with
 * data-process/run-active-test/src/config.ts (same envId, flagKey, variants,
 * metrics, and simulated conversion rates so the generated data can be read
 * back as the same experiment).
 */

// ── FeatBit/cf-worker routing ─────────────────────────────────────────────────

export const FLAG_KEY      = "run-active-test";
export const EXPERIMENT_ID = "a0000000-0000-0000-0000-000000000001";

// ── Variants ──────────────────────────────────────────────────────────────────

export const CONTROL_VARIANT   = "control";
export const TREATMENT_VARIANT = "treatment";

// ── Metrics ───────────────────────────────────────────────────────────────────

export const PRIMARY_METRIC_EVENT = "checkout-completed";
export const GUARDRAIL_EVENTS = [
  "page-load-error",
  "rage-click",
  "session-bounce",
] as const;

// ── Simulated behavior ────────────────────────────────────────────────────────

export const CONTROL_CONV_RATE   = 0.15;
export const TREATMENT_CONV_RATE = 0.20;
export const GUARDRAIL_FIRE_RATE = 0.05;
