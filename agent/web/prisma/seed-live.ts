/**
 * seed-live.ts — inserts one live "running" experiment for simulator observation
 *
 * Scenario: Checkout Flow A/B
 *   Flag key:   checkout-flow-ab
 *   Env secret: checkout-env-secret-live-001
 *   Control:    standard   (CVR ~22%)
 *   Treatment:  streamlined (CVR ~29%)
 *   Metric:     purchase_completed
 *
 * Run inside the web container:
 *   npx tsx prisma/seed-live.ts
 */

import "dotenv/config";
import { PrismaClient } from "../src/generated/prisma";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";

const pool = new Pool({ connectionString: process.env.DATABASE_URL! });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

async function main() {
  // Clean up any previous run of this script
  const existing = await prisma.experiment.findFirst({
    where: { name: "Checkout Flow Optimisation" },
  });
  if (existing) {
    await prisma.experiment.delete({ where: { id: existing.id } });
    console.log("Removed previous checkout experiment.");
  }

  // ── Create Experiment (parent) ───────────────────────────────────────────────
  const experiment = await prisma.experiment.create({
    data: {
      name: "Checkout Flow Optimisation",
      description:
        "Test whether a streamlined checkout (fewer steps, inline validation) increases purchase completion versus the current standard 4-step flow.",
      stage: "measuring",
      flagKey: "checkout-flow-ab",
      envSecret: "checkout-env-secret-live-001",

      // CF-01 Intent
      intent:
        "Users are abandoning checkout at a 78% rate. Post-purchase surveys and session recordings show that the 4-step checkout form is the top-cited reason. We need to determine whether reducing that friction converts more buyers before the Q2 revenue target review.",

      // CF-02 Goal & Hypothesis
      goal: "Increase purchase completion rate from 22% → 29% within 14 days.",
      hypothesis:
        "If we reduce checkout from 4 steps to 2 steps with inline field validation, purchase_completed rate will increase by ≥ 7 percentage points because friction is the primary drop-off cause.",

      // CF-03/04 Change (what is being built and gated)
      change:
        "New 'streamlined' checkout variant: consolidates shipping + payment into a single scrollable page with real-time inline field validation. Gated behind the checkout-flow-ab feature flag (user_id dispatch key, 50/50 split). No backend API changes — UI layer only.",

      // CF-05 Primary metric with rationale
      primaryMetric:
        "purchase_completed — chosen as the north star because it is the direct revenue signal and captures the full funnel impact. Secondary proxies (add-to-cart, checkout-started) are already high; the gap is at purchase confirmation. Binary metric: 1 if order-confirmation page is reached within the session, 0 otherwise. Counted once per user.",

      // CF-05 Guardrails
      guardrails:
        "checkout_abandoned — must not increase (streamlined flow must not confuse users into giving up).\nsupport_chat_open — must not increase (change must not generate more customer support demand).",

      // Constraints
      constraints:
        "Must not break guest checkout flow (not in this experiment scope). Mobile breakpoints must be preserved. Experiment window capped at 14 days due to Q2 deadline. Minimum 300 samples per variant required before any decision.",

      // Variants — pipe-separated "name (annotation)" format used by flag-config UI
      variants: "standard (control)|streamlined (treatment)",
    },
  });

  console.log(`Created experiment: ${experiment.id}`);

  // ── Create ExperimentRun (status = running) ──────────────────────────────────
  const now = new Date();
  const startDate = new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000); // 3 days ago
  const endDate   = new Date(now.getTime() + 11 * 24 * 60 * 60 * 1000); // +11 days

  const run = await prisma.experimentRun.create({
    data: {
      experimentId: experiment.id,
      slug: "checkout-streamlined-v1",
      status: "running",

      hypothesis:
        "Reducing checkout from 4 steps to 2 steps with inline field validation will increase purchase_completed by ≥ 7 pp because friction is the primary drop-off cause.",
      method: "bayesian_ab",
      methodReason:
        "Binary ship/no-ship decision with two variants. Need full posterior for confident decision.",

      primaryMetricEvent: "purchase_completed",
      primaryMetricType: "binary",
      primaryMetricAgg: "once",
      metricDescription:
        "Percentage of users who reach the order-confirmation page within the session.",

      guardrailEvents: JSON.stringify(["checkout_abandoned", "support_chat_open"]),
      guardrailDescriptions: JSON.stringify({
        checkout_abandoned: "Must not increase — streamlined flow must not confuse users.",
        support_chat_open:  "Must not increase — should not create more support questions.",
      }),

      controlVariant:   "standard",
      treatmentVariant: "streamlined",
      trafficAllocation:
        "50/50 split via checkout-flow-ab flag. Dispatch key: user_id. All logged-in users with items in cart are eligible.",

      minimumSample: 300,
      observationStart: startDate,
      observationEnd:   endDate,
      priorProper:  false,
      priorMean:    0.0,
      priorStddev:  0.3,
      trafficPercent: 100,
      trafficOffset: 0,
    },
  });

  console.log(`Created experiment run: ${run.id}  slug=${run.slug}  status=${run.status}`);
  console.log(`\nSimulator config needed:`);
  console.log(`  ENV_SECRET:              checkout-env-secret-live-001`);
  console.log(`  SCENARIO_1_FLAG_KEY:     checkout-flow-ab`);
  console.log(`  SCENARIO_1_VARIANTS:     standard,streamlined`);
  console.log(`  SCENARIO_1_METRIC_EVENT: purchase_completed`);
  console.log(`  SCENARIO_1_CONV_RATES:   0.220,0.290`);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
