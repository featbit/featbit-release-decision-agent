/**
 * Fixed identifiers and experiment content for the run-active-test.
 *
 * These IDs are hard-coded on purpose — setup-db uses them to idempotently
 * upsert exactly one experiment + experiment_run record in PostgreSQL, so
 * the pipeline always has a known "running" experiment generating data.
 */

// ── Fixed IDs (DO NOT change — existing DB rows depend on these) ──────────────

export const EXPERIMENT_ID     = "a0000000-0000-0000-0000-000000000001";
export const EXPERIMENT_RUN_ID = "b0000000-0000-0000-0000-000000000001";
export const EXPERIMENT_RUN_SLUG = "run-active-test-v1";

// ── FeatBit/cf-worker routing ─────────────────────────────────────────────────

export const ENV_ID   = "rat-env-v1";     // arbitrary; used as featbit_env_id
export const FLAG_KEY = "run-active-test"; // used as the flagKey in track payloads

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

// ── Simulated behavior (treatment slightly outperforms control) ───────────────

export const CONTROL_CONV_RATE   = 0.15;   // 15% baseline
export const TREATMENT_CONV_RATE = 0.20;   // 20% lift

// Per-event probability that a guardrail fires (kept low on purpose)
export const GUARDRAIL_FIRE_RATE = 0.05;

// ── Experiment content (used when upserting into PostgreSQL) ──────────────────

// Stored as JSON strings on the parent `experiment` table — these are the
// shapes the web UI expects (see metric-edit.tsx, flag-config.tsx).

export const PRIMARY_METRIC_JSON = JSON.stringify({
  name:        "Checkout Completion Rate",
  event:       PRIMARY_METRIC_EVENT,
  metricType:  "binary",
  metricAgg:   "once",
  description: "Fraction of users who complete the checkout flow after seeing the experimental page.",
});

export const GUARDRAILS_JSON = JSON.stringify([
  { name: "page-load-error", description: "Client-side JS error on page load — technical health guardrail." },
  { name: "rage-click",      description: "Repeated rapid clicks on the same element — UX frustration guardrail." },
  { name: "session-bounce",  description: "Session ends within 10s of landing — engagement guardrail." },
]);

export const VARIANTS_JSON = JSON.stringify([
  { key: CONTROL_VARIANT,   description: "No banner on checkout (baseline)." },
  { key: TREATMENT_VARIANT, description: "Limited-time-offer banner shown above the checkout form." },
]);

export const EXPERIMENT_CONTENT = {
  name: "run-active-test",
  description:
    "Synthetic always-running experiment used by the data-process pipeline as an end-to-end health signal.",
  intent:
    "Continuously produce real flag evaluation and metric data so we can verify that cf-worker, rollup-service, and stats-service are all healthy without waiting for a real experiment to run.",
  hypothesis:
    "If rat-env-v1/run-active-test keeps receiving traffic and its analysis_result keeps updating, then the cf-worker → R2 → rollup-service → stats-service pipeline is healthy end-to-end.",
  goal:
    "Guarantee there is always at least one running experiment whose rolled-up rollup files and Bayesian analysis result are fresh, so the system can be observed working.",
  change:
    "Simulated: show a limited-time-offer banner on the checkout page (treatment) vs. no banner (control).",
  constraints:
    "Treatment conversion rate must stay above control; guardrail events must stay low; experiment must never move out of 'running' state.",
  // Valid stages: hypothesis | implementing | measuring | learning — see agent/web/src/lib/stages.ts
  stage: "measuring",
  primaryMetric: PRIMARY_METRIC_JSON,
  guardrails:    GUARDRAILS_JSON,
  variants:      VARIANTS_JSON,
  run: {
    status:             "running",
    method:             "bayesian_ab",
    methodReason:       "Bayesian A/B gives a chance-to-win readout that is easy to verify by eye while the test runs continuously.",
    primaryMetricEvent: PRIMARY_METRIC_EVENT,
    primaryMetricAgg:   "once",
    primaryMetricType:  "binary",
    controlVariant:     CONTROL_VARIANT,
    treatmentVariant:   TREATMENT_VARIANT,
    trafficAllocation:  "50/50",
    trafficPercent:     100,
    minimumSample:      1000,
    priorProper:        false,
    priorMean:          0.0,
    priorStddev:        0.3,
    metricDescription:
      "Primary = checkout-completed (binary). Guardrails = page-load-error, rage-click, session-bounce (all lower-is-better).",
    guardrailDescriptions:
      "page-load-error: technical health; rage-click: frustration; session-bounce: engagement.",
  },
};
