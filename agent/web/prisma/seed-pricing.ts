/**
 * Seed: Pricing Page Conversion Lift — multi-layer experiment demo
 *
 * Scenario: Increase FeatBit pricing page → free-trial signup conversion
 *   from 12 % to 18 %.
 *
 * Traffic architecture
 * ────────────────────
 *   Layer A  "layer-pricing-page"  — all visitors who land on /pricing
 *     Exp 1  pricing-hero-copy-ab          offset  0, 50 % of layer  (Bayesian A/B  — DECIDED)
 *     Exp 2  pricing-plan-highlight-bandit offset 50, 50 % of layer  (Bandit        — DECIDED)
 *   (Exp 1 ⊕ Exp 2 are MUTUALLY EXCLUSIVE: no user appears in both)
 *
 *   Layer B  "layer-signup-flow"   — users who clicked the CTA and opened the signup form
 *     Exp 3  signup-form-length-ab         offset  0, 100 % of layer (Bayesian A/B  — RUNNING)
 *
 * Guardrails
 *   Exp 1: support_chat_open, page_error — must not increase
 *   Exp 3: email_bounce, form_error_submitted — must not increase
 *
 * Run:  npx tsx prisma/seed-pricing.ts
 */

import "dotenv/config";
import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! });
const prisma = new PrismaClient({ adapter });

// ─── helpers ──────────────────────────────────────────────────────────────────

function d(offsetDays: number): Date {
  const base = new Date("2026-03-01T00:00:00Z");
  base.setDate(base.getDate() + offsetDays);
  return base;
}

// ─── Experiment 1 — Bayesian A/B: pricing-hero-copy-ab ────────────────────────
//
// Layer-A, offset=0, 50 % — "Start Free Trial" vs "Get Started Free"
// control: start-trial  n=529  k=63  (11.9 %)
// treatment: get-started-free  n=531  k=85  (16.0 %)
// guardrails: support_chat_open, page_error

const EXP1_INPUT = JSON.stringify({
  metrics: {
    trial_signup_started: {
      "start-trial":        { n: 529, k: 63 },
      "get-started-free":   { n: 531, k: 85 },
    },
    support_chat_open: {
      "start-trial":        { n: 529, k: 52 },
      "get-started-free":   { n: 531, k: 45 },
    },
    page_error: {
      "start-trial":        { n: 529, k: 11 },
      "get-started-free":   { n: 531, k: 9 },
    },
  },
});

const EXP1_ANALYSIS = JSON.stringify({
  type: "bayesian",
  experiment: "pricing-hero-copy-ab",
  computed_at: "2026-03-22T16:45:00Z",
  window: { start: "2026-03-09", end: "2026-03-22" },
  control: "start-trial",
  treatments: ["get-started-free"],
  prior: "flat/improper (data-only)",
  srm: {
    chi2_p_value: 0.4817,
    ok: true,
    observed: { "start-trial": 529, "get-started-free": 531 },
  },
  primary_metric: {
    event: "trial_signup_started",
    metric_type: "proportion",
    inverse: false,
    rows: [
      {
        variant: "start-trial",
        n: 529, conversions: 63, rate: 0.1191,
        is_control: true,
      },
      {
        variant: "get-started-free",
        n: 531, conversions: 85, rate: 0.1601,
        rel_delta: 0.3443, ci_lower: 0.1408, ci_upper: 0.5478,
        p_win: 0.973, risk_ctrl: 0.0389, risk_trt: 0.0012,
        is_control: false,
      },
    ],
    verdict: "strong signal — adopt treatment (get-started-free)",
  },
  guardrails: [
    {
      event: "support_chat_open",
      metric_type: "proportion",
      inverse: false,
      rows: [
        { variant: "start-trial",      n: 529, conversions: 52, rate: 0.0983, is_control: true },
        { variant: "get-started-free", n: 531, conversions: 45, rate: 0.0847,
          rel_delta: -0.1383, ci_lower: -0.3014, ci_upper: 0.0521,
          p_harm: 0.103, risk_ctrl: 0.0031, risk_trt: 0.0044, is_control: false },
      ],
      verdict: "guardrail healthy — support chat load not increased (−13.8 % delta, P(harm)=10.3 %)",
    },
    {
      event: "page_error",
      metric_type: "proportion",
      inverse: false,
      rows: [
        { variant: "start-trial",      n: 529, conversions: 11, rate: 0.0208, is_control: true },
        { variant: "get-started-free", n: 531, conversions:  9, rate: 0.0169,
          rel_delta: -0.1875, ci_lower: -0.6014, ci_upper: 0.2781,
          p_harm: 0.241, risk_ctrl: 0.0019, risk_trt: 0.0024, is_control: false },
      ],
      verdict: "guardrail healthy — page error rate not increased (P(harm)=24.1 %)",
    },
  ],
  sample_check: {
    minimum_per_variant: 485,
    ok: true,
    variants: { "start-trial": 529, "get-started-free": 531 },
  },
});

// ─── Experiment 2 — Bandit: pricing-plan-highlight-bandit ─────────────────────
//
// Layer-A, offset=50, 50 % — Thompson Sampling over plan highlight position
// arms: no-highlight n=212 k=29 (13.7 %)
//       highlight-pro n=287 k=71 (24.7 %)
//       highlight-starter n=181 k=34 (18.8 %)

const EXP2_INPUT = JSON.stringify({
  metrics: {
    plan_click: {
      "no-highlight":       { n: 212, k: 29 },
      "highlight-pro":      { n: 287, k: 71 },
      "highlight-starter":  { n: 181, k: 34 },
    },
  },
});

const EXP2_ANALYSIS = JSON.stringify({
  type: "bandit",
  experiment: "pricing-plan-highlight-bandit",
  computed_at: "2026-03-21T11:22:00Z",
  window: { start: "2026-03-09", end: "2026-03-21" },
  metric: "plan_click",
  algorithm: "Thompson Sampling (Beta-Binomial)",
  srm: {
    chi2_p_value: 0.3124,
    ok: true,
    observed: { "no-highlight": 212, "highlight-pro": 287, "highlight-starter": 181 },
  },
  arms: [
    { arm: "no-highlight",      n: 212, conversions: 29,  rate: 0.1368 },
    { arm: "highlight-pro",     n: 287, conversions: 71,  rate: 0.2474 },
    { arm: "highlight-starter", n: 181, conversions: 34,  rate: 0.1878 },
  ],
  thompson_sampling: {
    results: [
      { arm: "no-highlight",      p_best: 0.0101, recommended_weight: 0.12 },
      { arm: "highlight-pro",     p_best: 0.9631, recommended_weight: 0.72 },
      { arm: "highlight-starter", p_best: 0.0268, recommended_weight: 0.16 },
    ],
    enough_units: true,
    update_message: "successfully updated",
  },
  stopping: {
    met: true,
    best_arm: "highlight-pro",
    p_best: 0.9631,
    threshold: 0.95,
    message: "highlight-pro is the winning plan highlight with 96.3 % confidence",
  },
});

// ─── Experiment 3 — Bayesian A/B (RUNNING): signup-form-length-ab ─────────────
//
// Layer-B "layer-signup-flow", offset=0, 100 % — 7-field vs 3-field form
// control: full-form    n=243  k=51  (21.0 %)
// treatment: short-form n=247  k=67  (27.1 %)
// guardrails: email_bounce, form_error_submitted
//
// Intermediate analysis — P(win)=0.947, not yet ≥ 0.95 threshold.
// Status: running — continue collecting data.

const EXP3_INPUT = JSON.stringify({
  metrics: {
    signup_completed: {
      "full-form":  { n: 243, k: 51 },
      "short-form": { n: 247, k: 67 },
    },
    email_bounce: {
      "full-form":  { n: 243, k: 22 },
      "short-form": { n: 247, k: 20 },
    },
    form_error_submitted: {
      "full-form":  { n: 243, k: 34 },
      "short-form": { n: 247, k: 28 },
    },
  },
});

const EXP3_PARTIAL_ANALYSIS = JSON.stringify({
  type: "bayesian",
  experiment: "signup-form-length-ab",
  computed_at: "2026-04-11T08:00:00Z",
  window: { start: "2026-04-01", end: "2026-04-11" },
  control: "full-form",
  treatments: ["short-form"],
  prior: "flat/improper (data-only)",
  note: "INTERMEDIATE — below minimum sample (243/247 of 400 required). Continue collecting.",
  srm: {
    chi2_p_value: 0.7293,
    ok: true,
    observed: { "full-form": 243, "short-form": 247 },
  },
  primary_metric: {
    event: "signup_completed",
    metric_type: "proportion",
    inverse: false,
    rows: [
      {
        variant: "full-form",
        n: 243, conversions: 51, rate: 0.2099,
        is_control: true,
      },
      {
        variant: "short-form",
        n: 247, conversions: 67, rate: 0.2713,
        rel_delta: 0.2925, ci_lower: 0.0482, ci_upper: 0.5589,
        p_win: 0.947, risk_ctrl: 0.0231, risk_trt: 0.0014,
        is_control: false,
      },
    ],
    verdict: "trending positive — P(win)=94.7 % but below 95 % threshold; continue collecting",
  },
  guardrails: [
    {
      event: "email_bounce",
      metric_type: "proportion",
      inverse: false,
      rows: [
        { variant: "full-form",  n: 243, conversions: 22, rate: 0.0905, is_control: true },
        { variant: "short-form", n: 247, conversions: 20, rate: 0.0810,
          rel_delta: -0.1050, ci_lower: -0.3942, ci_upper: 0.1891,
          p_harm: 0.196, risk_ctrl: 0.0028, risk_trt: 0.0033, is_control: false },
      ],
      verdict: "guardrail healthy — email bounce not increasing (P(harm)=19.6 %)",
    },
    {
      event: "form_error_submitted",
      metric_type: "proportion",
      inverse: false,
      rows: [
        { variant: "full-form",  n: 243, conversions: 34, rate: 0.1399, is_control: true },
        { variant: "short-form", n: 247, conversions: 28, rate: 0.1134,
          rel_delta: -0.1894, ci_lower: -0.4627, ci_upper: 0.1021,
          p_harm: 0.131, risk_ctrl: 0.0061, risk_trt: 0.0083, is_control: false },
      ],
      verdict: "guardrail healthy — form errors trending down (P(harm)=13.1 %)",
    },
  ],
  sample_check: {
    minimum_per_variant: 400,
    ok: false,
    deficit: 153,
    variants: { "full-form": 243, "short-form": 247 },
    message: "below minimum — need ~153 more users per variant before decision",
  },
});

// ─── main seed ────────────────────────────────────────────────────────────────

async function main() {
  await prisma.project.deleteMany({ where: { name: "Pricing Page Conversion Lift" } });

  // ── Project ────────────────────────────────────────────────────────────────
  // flagKey and envSecret are set to match the ACTIVE (running) experiment so
  // the ExperimentWorker can collect live events for Exp 3.
  const project = await prisma.project.create({
    data: {
      name: "Pricing Page Conversion Lift",
      description:
        "Increase pricing page → free-trial signup conversion from 12 % to 18 % via CTA copy, plan highlighting, and signup-form friction reduction.",
      stage: "measuring",
      flagKey: "signup-form-length",    // active flag key for ExperimentWorker
      envSecret: "pricing-env-secret-001",
      flagServerUrl: "https://featbit.example.com",

      goal:
        "Increase the percentage of pricing-page visitors who start a free trial from 12 % to 18 % within one quarter.",
      intent:
        "The pricing page has a poor CTA, no plan hierarchy signal, and a friction-heavy signup form. We want to address all three in a single sprint using mutually exclusive experiments on a shared layer so we don't pollute each other's signal.",
      hypothesis:
        "If we (a) rewrite the hero CTA to 'Get Started Free', (b) visually highlight the Pro plan, and (c) shorten the signup form to 3 fields, then we will observe a statistically significant lift in free-trial signups because each change removes a specific friction point identified in session-replay analysis.",
      change:
        "Three feature flags deployed behind two traffic layers:\n" +
        "  Layer A (pricing-page): pricing-hero-copy (offset 0–49) and pricing-plan-highlight (offset 50–99) run simultaneously but on non-overlapping user segments.\n" +
        "  Layer B (signup-flow): signup-form-length covers 100 % of users who open the form.",
      variants:
        "pricing-hero-copy: start-trial (ctrl) | get-started-free\n" +
        "pricing-plan-highlight: no-highlight (ctrl) | highlight-pro | highlight-starter\n" +
        "signup-form-length: full-form (ctrl, 7 fields) | short-form (3 fields)",
      primaryMetric:
        "trial_signup_started — % of pricing-page visitors who click a CTA and land on the signup form",
      guardrails:
        "support_chat_open — must not increase (pricing-hero-copy experiment)\n" +
        "page_error — must not increase (pricing-hero-copy experiment)\n" +
        "email_bounce — must not increase (signup-form-length experiment)\n" +
        "form_error_submitted — must not increase (signup-form-length experiment)",
      constraints:
        "Experiments on Layer A are mutually exclusive: a user is in exactly one of Exp 1 or Exp 2, never both. Exp 3 (Layer B) is independent and may overlap with Layer A participants.",
      openQuestions:
        "Does form shortening affect downstream email deliverability at scale? (monitor email_bounce beyond current window)",
      lastAction:
        "Exp 1 (hero copy) and Exp 2 (plan highlight) both decided CONTINUE on Mar 21-22. " +
        "Exp 3 (signup form) started Apr 1 and is currently collecting data — P(win)=94.7 %, below 95 % threshold.",
      lastLearning: null,
    },
  });

  // ── Experiment 1 — Bayesian A/B ────────────────────────────────────────────
  await prisma.experiment.create({
    data: {
      projectId: project.id,
      slug: "pricing-hero-copy-ab",
      status: "decided",

      hypothesis:
        "Changing the hero CTA from 'Start Free Trial' to 'Get Started Free' will increase the click-to-signup rate because the new copy reduces perceived commitment and anchors to the free tier.",
      method: "bayesian_ab",
      methodReason:
        "Binary choice (two copy variants), high decision stakes (changes the default for all visitors), requires credible intervals and P(win) for a confident ship decision. Bayesian A/B gives us posterior distributions, risk estimates, and a clear stopping rule (P(win) ≥ 95 %).",

      primaryMetricEvent: "trial_signup_started",
      metricDescription:
        "Percentage of pricing-page visitors assigned to this experiment who fire the trial_signup_started event (clicking the hero CTA and reaching the signup form entry).",
      guardrailEvents: JSON.stringify(["support_chat_open", "page_error"]),
      guardrailDescriptions: JSON.stringify({
        support_chat_open:
          "Must not increase — if copy causes confusion, support load will rise. Acceptable if P(harm) < 30 %.",
        page_error:
          "Must not increase — any rendering regression from the CTA component must be caught. Acceptable if P(harm) < 30 %.",
      }),

      controlVariant: "start-trial",
      treatmentVariant: "get-started-free",
      trafficAllocation:
        "Layer: layer-pricing-page. Traffic offset: 0. Traffic percent: 50 (users whose layer-hash bucket is 0–49). Within bucket: 50/50 stable hash split on user_id. Sticky assignment — variant persists for the experiment window.",
      layerId: "layer-pricing-page",
      trafficPercent: 50,
      trafficOffset: 0,
      audienceFilters: JSON.stringify({ plan: ["any"], source: ["pricing_page"] }),
      minimumSample: 485,
      observationStart: d(8),   // 2026-03-09
      observationEnd: d(21),    // 2026-03-22
      priorProper: false,
      priorMean: 0.0,
      priorStddev: 0.3,

      inputData: EXP1_INPUT,
      analysisResult: EXP1_ANALYSIS,

      decision: "CONTINUE",
      decisionSummary:
        "Ship 'Get Started Free' as the default hero CTA for all pricing-page visitors.",
      decisionReason:
        "P(win)=97.3 % for get-started-free, well above the 95 % threshold. +34.4 % relative lift on trial_signup_started (12.0 % → 16.0 %). Both guardrails healthy: support_chat_open P(harm)=10.3 %, page_error P(harm)=24.1 %. Both variants exceeded minimum sample (529/531 > 485).",

      whatChanged:
        "Deployed hero CTA copy variants behind pricing-hero-copy flag. Layer A, offset 0–49, 50/50 split. Observed 1060 users over 14 days.",
      whatHappened:
        "trial_signup_started lifted from 11.9 % to 16.0 % (+34.4 % relative). Support chat and page errors unchanged.",
      confirmedOrRefuted:
        "CONFIRMED — shorter, benefit-anchored copy ('Get Started Free') moves more visitors to signup than the commitment-framed 'Start Free Trial'.",
      whyItHappened:
        "Session-replay analysis previously identified that some users hesitated at the word 'Trial' (implied time limit). 'Get Started Free' emphasises the free-tier entry rather than the trial period, removing that friction.",
      nextHypothesis:
        "Now test whether highlighting the Pro plan (vs Starter vs no highlight) further increases plan selection intent on the same page.",
    },
  } as Parameters<typeof prisma.experiment.create>[0]);

  // ── Experiment 2 — Multi-arm Bandit ───────────────────────────────────────
  await prisma.experiment.create({
    data: {
      projectId: project.id,
      slug: "pricing-plan-highlight-bandit",
      status: "decided",

      hypothesis:
        "Highlighting one plan visually increases plan_click rate because it creates visual hierarchy and reduces decision paralysis. Pro is expected to win because it offers the best value and most users land on the pricing page intending mid-tier adoption.",
      method: "bandit",
      methodReason:
        "Three arms, fast signal (click within a session), and we want to minimise regret — we don't need to maintain a fixed 33/33/33 split while evidence accumulates. Thompson Sampling dynamically shifts traffic to the winning arm, maximising conversions during the experiment itself. Once P(best) ≥ 95 % we stop.",

      primaryMetricEvent: "plan_click",
      metricDescription:
        "Whether a pricing-page visitor assigned to this bandit clicks on any plan card. plan_click is a session-level binary signal — immediate feedback for Thompson Sampling reweighting.",
      guardrailEvents: JSON.stringify([]),
      guardrailDescriptions: JSON.stringify({}),

      controlVariant: "no-highlight",
      treatmentVariant: "highlight-pro | highlight-starter",
      trafficAllocation:
        "Layer: layer-pricing-page. Traffic offset: 50. Traffic percent: 50 (users whose layer-hash bucket is 50–99). Initial allocation: equal 1/3 split (burn-in). Thompson Sampling reweights daily based on posterior Beta(1+k, 1+n-k).",
      layerId: "layer-pricing-page",
      trafficPercent: 50,
      trafficOffset: 50,
      minimumSample: 100,
      observationStart: d(8),   // 2026-03-09
      observationEnd: d(20),    // 2026-03-21
      priorProper: false,
      priorMean: 0.0,
      priorStddev: 0.3,

      inputData: EXP2_INPUT,
      analysisResult: EXP2_ANALYSIS,

      decision: "CONTINUE",
      decisionSummary:
        "Ship highlight-pro as the permanent default plan highlight variant.",
      decisionReason:
        "Thompson Sampling gave highlight-pro P(best)=96.3 % after 13 days and 680 users, exceeding the 95 % stopping threshold. highlight-pro click rate 24.7 % vs 18.8 % (highlight-starter) and 13.7 % (no-highlight). Final traffic allocation: 72 % to highlight-pro.",

      whatChanged:
        "Three-arm Thompson Sampling bandit running on pricing-plan-highlight flag. Layer A, offset 50–99. Equal 1/3 burn-in for first 100 users/arm, then dynamic reallocation.",
      whatHappened:
        "highlight-pro dominated within 5 days. By day 13 it held 72 % of traffic and achieved P(best)=96.3 %. highlight-starter showed intermediate performance (18.8 %); no-highlight lagged at 13.7 %.",
      confirmedOrRefuted:
        "CONFIRMED — visual plan hierarchy significantly boosts plan click-through. highlight-pro outperforms both alternatives.",
      whyItHappened:
        "Pro is the sweet spot value tier — most visitors already have Pro intent. Visual highlighting gives them permission to commit. Starter highlight was less effective because too few visitors are seeking a limited tier.",
      nextHypothesis:
        "With CTA copy (Exp 1) and plan highlight (Exp 2) fixed to their winning variants, test signup form length to complete the funnel optimisation.",
    },
  } as Parameters<typeof prisma.experiment.create>[0]);

  // ── Experiment 3 — Bayesian A/B (RUNNING) ─────────────────────────────────
  await prisma.experiment.create({
    data: {
      projectId: project.id,
      slug: "signup-form-length-ab",
      status: "running",           // picked up by ExperimentWorker

      hypothesis:
        "Shortening the signup form from 7 fields to 3 fields will increase signup_completed rate because each additional field is a drop-off opportunity, and the removed fields (company size, job title, phone) can be collected post-onboarding.",
      method: "bayesian_ab",
      methodReason:
        "Binary choice, downstream conversion metric (signup_completed), and we need credible intervals to ensure email quality does not degrade (email_bounce guardrail). Bayesian A/B with P(win) ≥ 95 % threshold and guardrail monitoring. We also need the posterior to determine whether to run a follow-up experiment on form field order.",

      primaryMetricEvent: "signup_completed",
      metricDescription:
        "Percentage of users who opened the signup form and successfully submitted it (signup_completed event). Tracks form-level conversion — the funnel step immediately after the pricing page.",
      guardrailEvents: JSON.stringify(["email_bounce", "form_error_submitted"]),
      guardrailDescriptions: JSON.stringify({
        email_bounce:
          "Must not increase — removing email-confirmation field should not reduce address quality. Acceptable if P(harm) < 30 %.",
        form_error_submitted:
          "Must not increase — the short form must not introduce new validation errors. Acceptable if P(harm) < 30 %.",
      }),

      controlVariant: "full-form",
      treatmentVariant: "short-form",
      trafficAllocation:
        "Layer: layer-signup-flow (downstream layer for users who opened the signup page). Traffic offset: 0. Traffic percent: 100 (all signup-page visitors). 50/50 stable hash split on user_id. No overlap constraint with Layer A experiments — different funnel stage.",
      layerId: "layer-signup-flow",
      trafficPercent: 100,
      trafficOffset: 0,
      minimumSample: 400,
      observationStart: d(31),   // 2026-04-01
      observationEnd: null,      // still running
      priorProper: false,
      priorMean: 0.0,
      priorStddev: 0.3,

      // Intermediate data and partial analysis (ExperimentWorker will overwrite with live data)
      inputData: EXP3_INPUT,
      analysisResult: EXP3_PARTIAL_ANALYSIS,

      decision: null,
      decisionSummary: null,
      decisionReason: null,
    },
  } as Parameters<typeof prisma.experiment.create>[0]);

  // ── Activities — full project timeline ────────────────────────────────────
  const activities = [
    // ─ Intent & hypothesis ─
    {
      type: "stage_change",
      title: "Project created",
      detail: 'Release decision project "Pricing Page Conversion Lift" created. Stage: intent.',
      createdAt: d(0),
    },
    {
      type: "note",
      title: "Intent captured",
      detail:
        "Goal: lift pricing-page → free-trial conversion from 12 % to 18 %. " +
        "Root causes identified via session replay: (1) CTA copy implies commitment, (2) no plan hierarchy, (3) long signup form.",
      createdAt: d(0),
    },
    {
      type: "stage_change",
      title: "Stage changed to hypothesis",
      detail:
        "Hypothesis: three independent changes each address one friction point. " +
        "Run them as parallel + sequential experiments using two layers to maintain clean causal attribution.",
      createdAt: d(1),
    },
    // ─ Implementation ─
    {
      type: "stage_change",
      title: "Stage changed to implementing",
      detail:
        "Two-layer architecture chosen:\n" +
        "  Layer A (pricing-page): Exp 1 (hero copy, offset 0–49) + Exp 2 (plan highlight, offset 50–99) run simultaneously. " +
        "Mutual exclusion prevents interaction effects on the same page section.\n" +
        "  Layer B (signup-flow): Exp 3 starts after Exp 1 proves the CTA lifts CTR (otherwise Exp 3 would have thin traffic). " +
        "Sequential start with Exp 3 delayed ~3 weeks until Layer A concludes.",
      createdAt: d(3),
    },
    {
      type: "note",
      title: "Flags configured",
      detail:
        "Three feature flags deployed:\n" +
        "  pricing-hero-copy: start-trial (ctrl) | get-started-free\n" +
        "  pricing-plan-highlight: no-highlight (ctrl) | highlight-pro | highlight-starter\n" +
        "  signup-form-length: full-form (ctrl) | short-form\n" +
        "SDK integrated. Events instrumented: trial_signup_started, plan_click, signup_completed, support_chat_open, page_error, email_bounce, form_error_submitted.",
      createdAt: d(5),
    },
    // ─ Layer A experiments start ─
    {
      type: "stage_change",
      title: "Stage changed to measuring",
      detail:
        "Observation window open: 2026-03-09. Exp 1 minimum sample: 485/variant. " +
        "Exp 2 burn-in: 100/arm. Both experiments started simultaneously on Layer A.",
      createdAt: d(7),
    },
    {
      type: "note",
      title: "Exp 1 & Exp 2 started",
      detail:
        "Exp 1 (pricing-hero-copy-ab): Bayesian A/B, control=start-trial vs treatment=get-started-free. Layer A, offset 0–49.\n" +
        "Exp 2 (pricing-plan-highlight-bandit): Thompson Sampling, 3 arms. Layer A, offset 50–99.\n" +
        "Users in offset 0–49 are in Exp 1 only. Users in offset 50–99 are in Exp 2 only. No overlap.",
      createdAt: d(8),
    },
    {
      type: "note",
      title: "Exp 2 bandit reweight — day 4",
      detail:
        "Thompson Sampling weights updated: no-highlight=0.28, highlight-pro=0.42, highlight-starter=0.30. " +
        "highlight-pro accumulating wins. Early signal only — burn-in not complete.",
      createdAt: d(12),
    },
    {
      type: "note",
      title: "Exp 1 day 8 interim check",
      detail:
        "P(win)=93.1 % for get-started-free. Not yet at 95 % threshold. Guardrails nominal. Continuing.",
      createdAt: d(16),
    },
    {
      type: "note",
      title: "Exp 2 bandit reweight — day 9",
      detail:
        "Thompson Sampling weights updated: no-highlight=0.14, highlight-pro=0.62, highlight-starter=0.24. " +
        "P(best) for highlight-pro = 0.891. Approaching stopping threshold.",
      createdAt: d(17),
    },
    // ─ Exp 2 decided ─
    {
      type: "decision",
      title: "Decision: CONTINUE — pricing-plan-highlight-bandit",
      detail:
        "highlight-pro reached P(best)=96.3 % (≥ 95 % threshold) after 680 users over 13 days. " +
        "Final weights: highlight-pro 72 %. Shipping highlight-pro as permanent default.",
      createdAt: d(20),
    },
    // ─ Exp 1 decided ─
    {
      type: "decision",
      title: "Decision: CONTINUE — pricing-hero-copy-ab",
      detail:
        "get-started-free reached P(win)=97.3 % after 1060 users over 14 days. " +
        "+34.4 % lift on trial_signup_started. All guardrails healthy. Shipping get-started-free as default CTA.",
      createdAt: d(21),
    },
    {
      type: "note",
      title: "Layer A experiments concluded",
      detail:
        "Both pricing-page experiments decided. pricing-hero-copy locked to get-started-free. " +
        "pricing-plan-highlight locked to highlight-pro. " +
        "Preparing Exp 3 (signup form length) on Layer B — will start Apr 1 with improved CTA traffic driving the signup funnel.",
      createdAt: d(23),
    },
    // ─ Exp 3 start ─
    {
      type: "note",
      title: "Exp 3 started: signup-form-length-ab",
      detail:
        "Layer B (signup-flow), 100 % traffic. Control: full-form (7 fields). Treatment: short-form (3 fields — email, password, name). " +
        "Removed fields: company size, job title, phone number, country. These will be collected in onboarding flow post-signup. " +
        "Minimum sample: 400/variant. Guardrails: email_bounce, form_error_submitted.",
      createdAt: d(31),
    },
    {
      type: "note",
      title: "Exp 3 day 6 interim check",
      detail:
        "P(win)=88.4 % for short-form. Below 95 % threshold. 192/196 users — well below minimum 400. " +
        "Guardrails nominal (email_bounce and form_error_submitted both healthy). Continuing.",
      createdAt: d(37),
    },
    {
      type: "note",
      title: "Exp 3 day 10 interim check",
      detail:
        "P(win)=94.7 % for short-form. Signal strengthening — 243/247 users, still below minimum 400. " +
        "Guardrails remain healthy. Need approx 153 more users per variant before reaching minimum sample. " +
        "Projected stopping date: ~Apr 18–20 if traffic stays constant.",
      createdAt: d(41),
    },
  ];

  for (const a of activities) {
    await prisma.activity.create({
      data: { projectId: project.id, ...a },
    });
  }

  console.log(`✓ Project created: ${project.id}`);
  console.log(`✓ 3 experiments seeded`);
  console.log(`  · Exp 1  pricing-hero-copy-ab              (Bayesian A/B, decided)  Layer-A offset 0`);
  console.log(`  · Exp 2  pricing-plan-highlight-bandit      (Bandit,       decided)  Layer-A offset 50`);
  console.log(`  · Exp 3  signup-form-length-ab              (Bayesian A/B, running)  Layer-B offset 0`);
  console.log(`✓ ${activities.length} activities seeded`);
  console.log(`\nOpen: http://localhost:3000/projects/${project.id}`);
  console.log(`\nSimulator env vars for this project:`);
  console.log(`  ENV_SECRET=pricing-env-secret-001  SCENARIO_COUNT=3`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
