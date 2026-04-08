/**
 * seed-worker-test.ts — Seed data for worker end-to-end testing
 *
 * Scenario: FeatBit onboarding checklist A/B test
 *   - Project "Onboarding Checklist" with one RUNNING Bayesian A/B experiment
 *   - Experiment has NO inputData yet — the worker is expected to populate it
 *   - FeatBit connection fields are intentionally left blank so the mock adapter
 *     in datasource.config.ts is used (add an entry matching `slug` below)
 *
 * Run:
 *   npx tsx prisma/seed-worker-test.ts
 *
 * After seeding, run the worker:
 *   cd ../worker && npm run collect
 *
 * Then verify inputData was written:
 *   npx tsx prisma/seed-worker-test.ts --verify
 */

import "dotenv/config";
import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! });
const prisma = new PrismaClient({ adapter });

// ─── helpers ──────────────────────────────────────────────────────────────────

function d(offsetDays: number): Date {
  const base = new Date("2026-04-01T00:00:00Z");
  base.setDate(base.getDate() + offsetDays);
  return base;
}

// ─── main ──────────────────────────────────────────────────────────────────────

async function main() {
  const isVerify = process.argv.includes("--verify");

  if (isVerify) {
    await verify();
    return;
  }

  // Clean up any previous run
  await prisma.project.deleteMany({ where: { name: "Onboarding Checklist Test" } });
  console.log("previous seed removed");

  // ── Project ──────────────────────────────────────────────────────────────────
  // FeatBit connection fields are blank so the worker falls back to the
  // mock adapter configured in agent/worker/datasource.config.ts.
  // Set these to real values if you want to test the featbit adapter instead.
  const project = await prisma.project.create({
    data: {
      name: "Onboarding Checklist Test",
      description:
        "Test project for worker e2e — validates that the collect script writes inputData to a running experiment.",
      stage: "measuring",

      // ── FeatBit connection (blank → mock adapter in datasource.config.ts) ──
      flagKey:       "onboarding-checklist",
      envSecret:     "",
      accessToken:   "",
      flagServerUrl: "",

      // Decision state
      goal:
        "Increase the percentage of new users who complete all 5 onboarding steps within 7 days from 32% to 45%.",
      intent:
        "An interactive checklist surfaced on the dashboard home page should guide new users through key setup steps.",
      hypothesis:
        "If we show a persistent progress checklist on the dashboard home page to new users, then more of them will complete all 5 onboarding steps within 7 days (onboarding_completed event), because the checklist reduces cognitive load and makes the next action obvious.",
      change:
        "Add an OnboardingChecklist component behind the `onboarding-checklist` flag. Variants: control (no checklist) | checklist (persistent checklist with step highlights).",
      variants: "control (no checklist) | checklist (persistent interactive checklist)",
      primaryMetric:
        "onboarding_completed — % of new users who fire this event within 7 days of account creation",
      guardrails:
        "dashboard_time_on_page — must not decrease by more than 10% (checklist must not replace real engagement)\nfeature_flag_created — must not decrease (checklist must funnel users toward product value)",
      constraints:
        "Only accounts created in the last 14 days are eligible. Users are sticky-assigned via userId.",
      openQuestions:
        "Should the checklist persist on repeat visits or collapse after all steps are done?",
    },
  });

  console.log(`project created: ${project.id} ("${project.name}")`);

  // ── Experiment — RUNNING, no inputData yet ────────────────────────────────
  // status = "running" so getRunningExperiments() picks it up.
  // inputData = null so the worker has something to write.
  //
  // Slug must match the key in agent/worker/datasource.config.ts for the
  // mock adapter to kick in. Default config entry:
  //   { slug: "onboarding-checklist-v1", adapter: "mock", mockData: { ... } }
  const experiment = await prisma.experiment.create({
    data: {
      projectId: project.id,
      slug: "onboarding-checklist-v1",
      status: "running",

      hypothesis:
        "If we show a persistent progress checklist on the dashboard home page to new users, then more of them will complete all 5 onboarding steps within 7 days (onboarding_completed event), because the checklist reduces cognitive load and makes the next action obvious.",
      method: "bayesian_ab",
      methodReason:
        "Binary ship/no-ship decision with two variants. Bayesian A/B gives posterior probability and credible intervals for a clear go/no-go call.",
      primaryMetricEvent: "onboarding_completed",
      metricDescription:
        "Percentage of new users who fire the onboarding_completed event within 7 days of account creation.",
      guardrailEvents: JSON.stringify(["dashboard_time_on_page", "feature_flag_created"]),
      guardrailDescriptions: JSON.stringify({
        dashboard_time_on_page:
          "Must not decrease by more than 10% — checklist must not replace browsing engagement.",
        feature_flag_created:
          "Must not decrease — checklist must funnel users toward creating their first feature flag.",
      }),
      controlVariant: "control",
      treatmentVariant: "checklist",
      trafficAllocation:
        "Dispatch key: userId (sticky). 50/50 random split via flag onboarding-checklist. Only accounts created in the last 14 days enter the experiment.",
      minimumSample: 300,
      observationStart: d(0),   // 2026-04-01
      observationEnd:   d(14),  // 2026-04-15
      priorProper: false,

      inputData: null,       // ← worker will write this
      analysisResult: null,  // ← analysis script will write this after worker runs
    },
  });

  console.log(`experiment created: ${experiment.id} (slug="${experiment.slug}", status="${experiment.status}")`);
  console.log(`\ninputData is NULL — run the worker to populate it:`);
  console.log(`  cd agent/worker`);
  console.log(`  # PowerShell:`);
  console.log(`  $env:SYNC_API_URL="http://localhost:3000"; npm run collect`);
  console.log(`  # bash/zsh:`);
  console.log(`  SYNC_API_URL=http://localhost:3000 npm run collect`);
  console.log(`\nthen verify:`);
  console.log(`  cd agent/web && bun ./prisma/seed-worker-test.ts --verify`);
}

// ─── verify ───────────────────────────────────────────────────────────────────

async function verify() {
  const experiment = await prisma.experiment.findFirst({
    where: {
      slug: "onboarding-checklist-v1",
      project: { name: "Onboarding Checklist Test" },
    },
    select: { id: true, slug: true, status: true, inputData: true, updatedAt: true },
  });

  if (!experiment) {
    console.error("✗ experiment not found — run seed first");
    process.exit(1);
  }

  console.log(`experiment: ${experiment.id} (${experiment.slug})`);
  console.log(`status:     ${experiment.status}`);
  console.log(`updatedAt:  ${experiment.updatedAt.toISOString()}`);

  if (!experiment.inputData) {
    console.error(`\n✗ inputData is still NULL — worker has not run yet (or failed)`);
    process.exit(1);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(experiment.inputData);
  } catch {
    console.error(`\n✗ inputData is set but not valid JSON: ${experiment.inputData}`);
    process.exit(1);
  }

  console.log(`\n✓ inputData written by worker:`);
  console.log(JSON.stringify(parsed, null, 2));
}

// ─── run ──────────────────────────────────────────────────────────────────────

main()
  .catch(err => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
