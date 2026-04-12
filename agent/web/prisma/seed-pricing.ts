/**
 * Seed: Pricing Page Optimisation — single experiment, three sequential experiment runs
 *
 * All three experiment runs share flagKey="pricing-page" (one hash space, one experiment).
 * All experiments are SEQUENTIAL — each starts only after the previous one decides.
 * The flag's variant pool evolves between experiments (losing variants removed,
 * new challengers added); at any point in time the flag has a consistent variant set.
 *
 * Traffic architecture
 * ────────────────────
 *   Exp 1  pricing-cta-ab           offset 0, 100 %  (Bayesian A/B — DECIDED)
 *     Variants during Exp 1: original (ctrl) | free-cta
 *     → free-cta wins → original removed, free-cta-pro + free-cta-starter added
 *
 *   Exp 2  pricing-highlight-bandit offset 0, 100 %  (Bandit — DECIDED)
 *     Variants during Exp 2: free-cta (ctrl) | free-cta-pro | free-cta-starter
 *     → free-cta-pro wins → free-cta-starter removed, free-cta-pro-social added
 *
 *   Exp 3  pricing-social-proof-ab  offset 0, 100 %  (Bayesian A/B — COLLECTING)
 *     Variants during Exp 3: free-cta-pro (ctrl) | free-cta-pro-social
 *     → currently collecting (P(win)=94.7 %, below 95 % threshold)
 *
 * Each experiment uses trafficPercent=100, trafficOffset=0 (full sequential — no
 * mutual exclusion infrastructure needed). One experiment runs at a time.
 *
 * Guardrails
 *   Exp 1+3: support_chat_open, page_error — must not increase
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
  const base = new Date("2026-02-19T00:00:00Z");
  base.setDate(base.getDate() + offsetDays);
  return base;
}

// ─── Experiment 1 — Bayesian A/B: pricing-cta-ab ──────────────────────────────
//
// Sequential (first experiment): offset=0, 100 % — original page vs free-cta page
// Variant pool at Exp 1: original (ctrl) | free-cta
// control: original   n=529  k=63  (11.9 %)
// treatment: free-cta n=531  k=85  (16.0 %)
// guardrails: support_chat_open, page_error

const EXP1_INPUT = JSON.stringify({
  metrics: {
    trial_signup_started: {
      "original":  { n: 529, k: 63 },
      "free-cta":  { n: 531, k: 85 },
    },
    support_chat_open: {
      "original":  { n: 529, k: 52 },
      "free-cta":  { n: 531, k: 45 },
    },
    page_error: {
      "original":  { n: 529, k: 11 },
      "free-cta":  { n: 531, k:  9 },
    },
  },
});

const EXP1_ANALYSIS = JSON.stringify({
  type: "bayesian",
  experiment: "pricing-cta-ab",
  computed_at: "2026-03-12T16:45:00Z",
  window: { start: "2026-02-27", end: "2026-03-12" },
  control: "original",
  treatments: ["free-cta"],
  prior: "flat/improper (data-only)",
  srm: {
    chi2_p_value: 0.4817,
    ok: true,
    observed: { "original": 529, "free-cta": 531 },
  },
  primary_metric: {
    event: "trial_signup_started",
    metric_type: "proportion",
    inverse: false,
    rows: [
      {
        variant: "original",
        n: 529, conversions: 63, rate: 0.1191,
        is_control: true,
      },
      {
        variant: "free-cta",
        n: 531, conversions: 85, rate: 0.1601,
        rel_delta: 0.3443, ci_lower: 0.1408, ci_upper: 0.5478,
        p_win: 0.973, risk_ctrl: 0.0389, risk_trt: 0.0012,
        is_control: false,
      },
    ],
    verdict: "strong signal — adopt treatment (free-cta)",
  },
  guardrails: [
    {
      event: "support_chat_open",
      metric_type: "proportion",
      inverse: false,
      rows: [
        { variant: "original",  n: 529, conversions: 52, rate: 0.0983, is_control: true },
        { variant: "free-cta",  n: 531, conversions: 45, rate: 0.0847,
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
        { variant: "original",  n: 529, conversions: 11, rate: 0.0208, is_control: true },
        { variant: "free-cta",  n: 531, conversions:  9, rate: 0.0169,
          rel_delta: -0.1875, ci_lower: -0.6014, ci_upper: 0.2781,
          p_harm: 0.241, risk_ctrl: 0.0019, risk_trt: 0.0024, is_control: false },
      ],
      verdict: "guardrail healthy — page error rate not increased (P(harm)=24.1 %)",
    },
  ],
  sample_check: {
    minimum_per_variant: 485,
    ok: true,
    variants: { "original": 529, "free-cta": 531 },
  },
});

// ─── Experiment 2 — Bandit: pricing-highlight-bandit ──────────────────────────
//
// Sequential (starts after Exp 1 ships free-cta): offset=0, 100 %
// Variant pool at Exp 2: free-cta (ctrl) | free-cta-pro | free-cta-starter
// original removed after Exp 1; two challengers added.
// free-cta (no highlight)  n=212  k=29  (13.7 %)
// free-cta-pro             n=287  k=71  (24.7 %)
// free-cta-starter         n=181  k=34  (18.8 %)

const EXP2_INPUT = JSON.stringify({
  metrics: {
    plan_click: {
      "free-cta":          { n: 212, k: 29 },
      "free-cta-pro":      { n: 287, k: 71 },
      "free-cta-starter":  { n: 181, k: 34 },
    },
  },
});

const EXP2_ANALYSIS = JSON.stringify({
  type: "bandit",
  experiment: "pricing-highlight-bandit",
  computed_at: "2026-03-28T11:22:00Z",
  window: { start: "2026-03-16", end: "2026-03-28" },
  metric: "plan_click",
  algorithm: "Thompson Sampling (Beta-Binomial)",
  srm: {
    chi2_p_value: 0.3124,
    ok: true,
    observed: { "free-cta": 212, "free-cta-pro": 287, "free-cta-starter": 181 },
  },
  arms: [
    { arm: "free-cta",          n: 212, conversions: 29,  rate: 0.1368 },
    { arm: "free-cta-pro",      n: 287, conversions: 71,  rate: 0.2474 },
    { arm: "free-cta-starter",  n: 181, conversions: 34,  rate: 0.1878 },
  ],
  thompson_sampling: {
    results: [
      { arm: "free-cta",          p_best: 0.0101, recommended_weight: 0.12 },
      { arm: "free-cta-pro",      p_best: 0.9631, recommended_weight: 0.72 },
      { arm: "free-cta-starter",  p_best: 0.0268, recommended_weight: 0.16 },
    ],
    enough_units: true,
    update_message: "successfully updated",
  },
  stopping: {
    met: true,
    best_arm: "free-cta-pro",
    p_best: 0.9631,
    threshold: 0.95,
    message: "free-cta-pro is the winning plan highlight with 96.3 % confidence",
  },
});

// ─── Experiment 3 — Bayesian A/B (COLLECTING): pricing-social-proof-ab ────────
//
// Sequential (starts after Exp 2 ships free-cta-pro): offset=0, 100 %
// Variant pool at Exp 3: free-cta-pro (ctrl) | free-cta-pro-social
// free-cta-starter removed after Exp 2; free-cta-pro-social added.
// control: free-cta-pro          n=243  k=51  (21.0 %)
// treatment: free-cta-pro-social n=247  k=67  (27.1 %)
// guardrails: support_chat_open, page_error
//
// Intermediate analysis — P(win)=0.947, not yet ≥ 0.95 threshold.
// Status: collecting — continue accumulating data.

const EXP3_INPUT = JSON.stringify({
  metrics: {
    trial_signup_started: {
      "free-cta-pro":         { n: 243, k: 51 },
      "free-cta-pro-social":  { n: 247, k: 67 },
    },
    support_chat_open: {
      "free-cta-pro":         { n: 243, k: 22 },
      "free-cta-pro-social":  { n: 247, k: 20 },
    },
    page_error: {
      "free-cta-pro":         { n: 243, k: 11 },
      "free-cta-pro-social":  { n: 247, k:  9 },
    },
  },
});

const EXP3_PARTIAL_ANALYSIS = JSON.stringify({
  type: "bayesian",
  experiment: "pricing-social-proof-ab",
  computed_at: "2026-04-12T08:00:00Z",
  window: { start: "2026-04-01", end: "2026-04-12" },
  control: "free-cta-pro",
  treatments: ["free-cta-pro-social"],
  prior: "flat/improper (data-only)",
  note: "INTERMEDIATE — below minimum sample (243/247 of 400 required). Continue collecting.",
  srm: {
    chi2_p_value: 0.7293,
    ok: true,
    observed: { "free-cta-pro": 243, "free-cta-pro-social": 247 },
  },
  primary_metric: {
    event: "trial_signup_started",
    metric_type: "proportion",
    inverse: false,
    rows: [
      {
        variant: "free-cta-pro",
        n: 243, conversions: 51, rate: 0.2099,
        is_control: true,
      },
      {
        variant: "free-cta-pro-social",
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
      event: "support_chat_open",
      metric_type: "proportion",
      inverse: false,
      rows: [
        { variant: "free-cta-pro",        n: 243, conversions: 22, rate: 0.0905, is_control: true },
        { variant: "free-cta-pro-social", n: 247, conversions: 20, rate: 0.0810,
          rel_delta: -0.1050, ci_lower: -0.3942, ci_upper: 0.1891,
          p_harm: 0.196, risk_ctrl: 0.0028, risk_trt: 0.0033, is_control: false },
      ],
      verdict: "guardrail healthy — support chat load not increasing (P(harm)=19.6 %)",
    },
    {
      event: "page_error",
      metric_type: "proportion",
      inverse: false,
      rows: [
        { variant: "free-cta-pro",        n: 243, conversions: 11, rate: 0.0453, is_control: true },
        { variant: "free-cta-pro-social", n: 247, conversions:  9, rate: 0.0364,
          rel_delta: -0.1963, ci_lower: -0.6182, ci_upper: 0.2571,
          p_harm: 0.218, risk_ctrl: 0.0017, risk_trt: 0.0021, is_control: false },
      ],
      verdict: "guardrail healthy — page error rate not increased (P(harm)=21.8 %)",
    },
  ],
  sample_check: {
    minimum_per_variant: 400,
    ok: false,
    deficit: 153,
    variants: { "free-cta-pro": 243, "free-cta-pro-social": 247 },
    message: "below minimum — need ~153 more users per variant before decision",
  },
});

// ─── main seed ────────────────────────────────────────────────────────────────

async function main() {
  await prisma.experiment.deleteMany({
    where: { name: { in: ["Pricing Page Optimisation", "Signup Form Optimisation", "Pricing Page Conversion Lift"] } },
  });

  // ══════════════════════════════════════════════════════════════════════════
  // Single experiment: Pricing Page Optimisation
  // flagKey: "pricing-page"   envSecret: "pricing-env-secret-001"
  // Three sequential experiment runs — each starts after the previous one decides.
  // The flag's variant pool evolves: original→free-cta (Exp 1) →
  //   free-cta+(pro|starter) bandit (Exp 2) → free-cta-pro+social (Exp 3)
  // ══════════════════════════════════════════════════════════════════════════
  const experimentA = await prisma.experiment.create({
    data: {
      name: "Pricing Page Optimisation",
      description:
        "Lift pricing-page → free-trial signup conversion from 12 % to 21 % across three sequential experiments, " +
        "all under flagKey 'pricing-page'. Each experiment builds on the previous winner — the flag's variant pool evolves.",
      stage: "measuring",
      flagKey: "pricing-page",
      envSecret: "pricing-env-secret-001",
      flagServerUrl: "https://featbit.example.com",

      goal:
        "Increase the percentage of pricing-page visitors who start a free trial from 12 % to 21 % within one quarter.",
      intent:
        "The pricing page has three friction points: weak CTA copy, no visual plan hierarchy, and no social proof. " +
        "Each is addressed in a separate sequential experiment — Exp 1 tests the CTA, Exp 2 tests plan highlighting " +
        "(with the winning CTA live), Exp 3 tests social proof (with both prior winners live). " +
        "Sequential design keeps each experiment at full traffic and avoids confounding.",
      hypothesis:
        "If we (a) rewrite the hero CTA to anchor on free access, (b) visually highlight the Pro plan, and " +
        "(c) add customer social proof, pricing-page visitors will start trials at a higher rate because each change " +
        "removes a specific friction point identified in session-replay analysis.",
      change:
        "One feature flag: pricing-page. Three sequential experiments — variant pool evolves between each.\n" +
        "  Exp 1: control=original       → treatment=free-cta          [decided Mar 12]\n" +
        "  Exp 2: control=free-cta       → treatment=free-cta-pro (bandit)  [decided Mar 28]\n" +
        "  Exp 3: control=free-cta-pro   → treatment=free-cta-pro-social    [collecting]",
      variants:
        "Flag: pricing-page  (variant pool evolves per experiment)\n" +
        "  Exp 1 (Feb 27–Mar 12):  original (ctrl) | free-cta\n" +
        "  Exp 2 (Mar 16–Mar 28): free-cta (ctrl) | free-cta-pro | free-cta-starter\n" +
        "  Exp 3 (Apr 1–now):     free-cta-pro (ctrl) | free-cta-pro-social",
      primaryMetric:
        "trial_signup_started — % of pricing-page visitors who click a CTA and reach the signup form entry",
      guardrails:
        "support_chat_open — must not increase (Exp 1, Exp 3)\n" +
        "page_error — must not increase (Exp 1, Exp 3)",
      constraints:
        "Sequential design: Exp 2 does not start until Exp 1 decides and ships. " +
        "Exp 3 does not start until Exp 2 decides and ships. " +
        "Each experiment runs at 100 % of pricing-page traffic during its observation window. " +
        "The flag is updated between experiments (losing variants removed, new challengers added).",
      openQuestions:
        "Does social proof (testimonials + logo strip) appeal equally to all plan tiers, or does it primarily lift Pro intent?",
      lastAction:
        "Exp 1 (CTA copy) decided CONTINUE Mar 12. Exp 2 (plan highlight bandit) decided CONTINUE Mar 28. " +
        "Exp 3 (social proof) started Apr 1 — currently collecting, P(win)=94.7 %, below 95 % threshold.",
      lastLearning: null,
    },
  });

  // ── Experiment Run 1 — Bayesian A/B: pricing-cta-ab ───────────────────────────
  await prisma.experimentRun.create({
    data: {
      experimentId: experimentA.id,
      slug: "pricing-cta-ab",
      status: "decided",

      hypothesis:
        "Changing the hero CTA from the current 'Start Free Trial' framing to one anchored on free access " +
        "will increase the click-to-signup rate because the new copy reduces perceived commitment and emphasises " +
        "the free-tier entry rather than a trial period.",
      method: "bayesian_ab",
      methodReason:
        "Binary choice (two copy variants), high decision stakes (changes the default for all visitors), " +
        "requires credible intervals and P(win) for a confident ship decision. " +
        "Bayesian A/B gives us posterior distributions, risk estimates, and a clear stopping rule (P(win) ≥ 95 %).",

      primaryMetricEvent: "trial_signup_started",
      metricDescription:
        "Percentage of pricing-page visitors assigned to this experiment who fire the trial_signup_started event " +
        "(clicking the hero CTA and reaching the signup form entry).",
      guardrailEvents: JSON.stringify(["support_chat_open", "page_error"]),
      guardrailDescriptions: JSON.stringify({
        support_chat_open:
          "Must not increase — if copy causes confusion, support load will rise. Acceptable if P(harm) < 30 %.",
        page_error:
          "Must not increase — any rendering regression from the CTA component must be caught. Acceptable if P(harm) < 30 %.",
      }),

      controlVariant: "original",
      treatmentVariant: "free-cta",
      trafficAllocation:
        "flagKey: pricing-page. Variant pool: original | free-cta. " +
        "trafficOffset: 0, trafficPercent: 100 — all pricing-page visitors enrolled. " +
        "50/50 stable hash split on user_id within the flag. Sticky assignment.",
      layerId: null,
      trafficPercent: 100,
      trafficOffset: 0,
      audienceFilters: JSON.stringify({ plan: ["any"], source: ["pricing_page"] }),
      minimumSample: 485,
      observationStart: d(8),   // 2026-02-27
      observationEnd: d(21),    // 2026-03-12
      priorProper: false,
      priorMean: 0.0,
      priorStddev: 0.3,

      inputData: EXP1_INPUT,
      analysisResult: EXP1_ANALYSIS,

      decision: "CONTINUE",
      decisionSummary:
        "Ship the free-anchored CTA ('Get Started Free') as the default hero CTA for all pricing-page visitors. " +
        "The original variant is removed from the flag.",
      decisionReason:
        "P(win)=97.3 % for free-cta, well above the 95 % threshold. " +
        "+34.4 % relative lift on trial_signup_started (11.9 % → 16.0 %). " +
        "Both guardrails healthy: support_chat_open P(harm)=10.3 %, page_error P(harm)=24.1 %. " +
        "Both variants exceeded minimum sample (529/531 > 485).",

      whatChanged:
        "Deployed CTA copy variants behind pricing-page flag. " +
        "Variant pool: original (ctrl) | free-cta. 100 % traffic, 50/50 split. Observed 1 060 users over 14 days.",
      whatHappened:
        "trial_signup_started lifted from 11.9 % to 16.0 % (+34.4 % relative). " +
        "Support chat and page errors unchanged.",
      confirmedOrRefuted:
        "CONFIRMED — free-anchored copy moves more visitors to signup than the commitment-framed original.",
      whyItHappened:
        "Session-replay analysis previously identified that some users hesitated at the word 'Trial' (implied time limit). " +
        "Anchoring on 'Free' addresses that hesitation — visitors perceive less risk in clicking.",
      nextHypothesis:
        "With free-cta now live for all visitors, test whether visually highlighting one pricing plan " +
        "reduces decision paralysis and further increases plan selection and signup intent.",
    },
  } as Parameters<typeof prisma.experimentRun.create>[0]);

  // ── Experiment Run 2 — Multi-arm Bandit: pricing-highlight-bandit ─────────────
  await prisma.experimentRun.create({
    data: {
      experimentId: experimentA.id,
      slug: "pricing-highlight-bandit",
      status: "decided",

      hypothesis:
        "Highlighting one plan visually increases plan_click rate because it creates visual hierarchy and " +
        "reduces decision paralysis. Pro is expected to win because it offers the best value-to-price ratio " +
        "and most visitors land on the pricing page intending mid-tier adoption.",
      method: "bandit",
      methodReason:
        "Three arms (no highlight, Pro highlighted, Starter highlighted), fast feedback signal (plan click within a session), " +
        "and we want to minimise regret — we don't need to maintain a fixed 1/3 split while evidence accumulates. " +
        "Thompson Sampling dynamically shifts traffic to the winning arm. Once P(best) ≥ 95 % we stop.",

      primaryMetricEvent: "plan_click",
      metricDescription:
        "Whether a pricing-page visitor assigned to this experiment clicks on any plan card. " +
        "Binary signal per session — immediate feedback for Thompson Sampling reweighting.",
      guardrailEvents: JSON.stringify([]),
      guardrailDescriptions: JSON.stringify({}),

      controlVariant: "free-cta",
      treatmentVariant: "free-cta-pro | free-cta-starter",
      trafficAllocation:
        "flagKey: pricing-page. Variant pool: free-cta (ctrl) | free-cta-pro | free-cta-starter. " +
        "trafficOffset: 0, trafficPercent: 100 — all pricing-page visitors enrolled. " +
        "Initial allocation: equal 1/3 burn-in. Thompson Sampling reweights daily.",
      layerId: null,
      trafficPercent: 100,
      trafficOffset: 0,
      minimumSample: 100,
      observationStart: d(25),  // 2026-03-16
      observationEnd: d(37),    // 2026-03-28
      priorProper: false,
      priorMean: 0.0,
      priorStddev: 0.3,

      inputData: EXP2_INPUT,
      analysisResult: EXP2_ANALYSIS,

      decision: "CONTINUE",
      decisionSummary:
        "Ship free-cta-pro (Pro plan visually highlighted) as the permanent default. " +
        "free-cta-starter variant is removed from the flag.",
      decisionReason:
        "Thompson Sampling gave free-cta-pro P(best)=96.3 % after 13 days and 680 users, " +
        "exceeding the 95 % stopping threshold. " +
        "free-cta-pro click rate 24.7 % vs 18.8 % (free-cta-starter) and 13.7 % (free-cta). " +
        "Final traffic allocation: 72 % to free-cta-pro.",

      whatChanged:
        "Three-arm Thompson Sampling bandit on pricing-page flag. " +
        "Variant pool: free-cta (ctrl, no highlight) | free-cta-pro | free-cta-starter. " +
        "100 % traffic, 1/3 burn-in then dynamic reallocation.",
      whatHappened:
        "free-cta-pro dominated within 5 days. By day 13 it held 72 % of traffic and achieved P(best)=96.3 %. " +
        "free-cta-starter showed intermediate performance (18.8 %); free-cta lagged at 13.7 %.",
      confirmedOrRefuted:
        "CONFIRMED — visual plan hierarchy significantly boosts plan click-through. " +
        "free-cta-pro outperforms both alternatives.",
      whyItHappened:
        "Pro is the sweet-spot value tier — most visitors already have Pro intent. " +
        "Visual highlighting gives them permission to commit. " +
        "Starter highlight was less effective because too few visitors are seeking a limited tier.",
      nextHypothesis:
        "With free-cta + Pro highlight live, test whether adding customer social proof " +
        "(testimonials + logo strip) further lifts free-trial signups.",
    },
  } as Parameters<typeof prisma.experimentRun.create>[0]);

  // ── Experiment Run 3 — Bayesian A/B (COLLECTING): pricing-social-proof-ab ──────
  await prisma.experimentRun.create({
    data: {
      experimentId: experimentA.id,
      slug: "pricing-social-proof-ab",
      status: "collecting",

      hypothesis:
        "Adding a social proof section (3 customer testimonials + logo strip of 8 brands) above the pricing tiers " +
        "will increase trial_signup_started rate because visitors who see evidence of existing customers experience " +
        "reduced adoption risk and higher trust.",
      method: "bayesian_ab",
      methodReason:
        "Binary choice (show or hide social proof section), high-stakes decision (permanent page change), " +
        "and we need credible intervals plus guardrail monitoring to ensure support load does not increase " +
        "(some social proof formats generate questions). Bayesian A/B with P(win) ≥ 95 % threshold.",

      primaryMetricEvent: "trial_signup_started",
      metricDescription:
        "Percentage of pricing-page visitors assigned to this experiment who click a CTA and fire the " +
        "trial_signup_started event. Sequential — runs on the improved baseline with free-cta CTA and " +
        "Pro plan highlight already live.",
      guardrailEvents: JSON.stringify(["support_chat_open", "page_error"]),
      guardrailDescriptions: JSON.stringify({
        support_chat_open:
          "Must not increase — social proof sections can generate questions if testimonials are ambiguous. " +
          "Acceptable if P(harm) < 30 %.",
        page_error:
          "Must not increase — images in the logo strip must not cause rendering regressions. " +
          "Acceptable if P(harm) < 30 %.",
      }),

      controlVariant: "free-cta-pro",
      treatmentVariant: "free-cta-pro-social",
      trafficAllocation:
        "flagKey: pricing-page. Variant pool: free-cta-pro (ctrl) | free-cta-pro-social. " +
        "trafficOffset: 0, trafficPercent: 100 — all pricing-page visitors enrolled. " +
        "50/50 stable hash split on user_id. Sticky assignment.",
      layerId: null,
      trafficPercent: 100,
      trafficOffset: 0,
      minimumSample: 400,
      observationStart: d(41),  // 2026-04-01
      observationEnd: null,     // still collecting
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
  } as Parameters<typeof prisma.experimentRun.create>[0]);

  // ── Activities ────────────────────────────────────────────────────────────
  const activitiesA = [
    {
      type: "stage_change",
      title: "Experiment created",
      detail: 'Release decision experiment "Pricing Page Optimisation" created. Stage: intent.',
      createdAt: d(0),
    },
    {
      type: "note",
      title: "Intent captured",
      detail:
        "Goal: lift pricing-page → free-trial conversion from 12 % to 21 %. " +
        "Root causes identified via session replay: (1) CTA copy implies commitment ('Trial'), " +
        "(2) no visual plan hierarchy, (3) no social proof.",
      createdAt: d(0),
    },
    {
      type: "stage_change",
      title: "Stage changed to hypothesis",
      detail:
        "Hypothesis: three independent changes each address one friction point on the pricing page. " +
        "Run as sequential experiments under one flag — each starts only after the previous one decides.",
      createdAt: d(1),
    },
    {
      type: "stage_change",
      title: "Stage changed to implementing",
      detail:
        "Sequential experiment plan under flagKey 'pricing-page':\n" +
        "  Exp 1: original vs free-cta — test CTA copy (100 % traffic)\n" +
        "  Exp 2: starts after Exp 1 ships — free-cta vs free-cta-pro vs free-cta-starter (bandit)\n" +
        "  Exp 3: starts after Exp 2 ships — free-cta-pro vs free-cta-pro-social\n" +
        "The flag's variant pool evolves between experiments.",
      createdAt: d(3),
    },
    {
      type: "note",
      title: "Flag contract defined",
      detail:
        "flagKey: pricing-page (one flag, three sequential experiments).\n" +
        "Exp 1 variant pool: original (ctrl) | free-cta\n" +
        "Events instrumented: trial_signup_started, plan_click, support_chat_open, page_error.",
      createdAt: d(5),
    },
    {
      type: "stage_change",
      title: "Stage changed to measuring",
      detail:
        "Observation window open: 2026-02-27. Exp 1 minimum sample: 485/variant. " +
        "Exp 1 started — sequential plan in motion.",
      createdAt: d(7),
    },
    {
      type: "note",
      title: "Exp 1 started: pricing-cta-ab",
      detail:
        "Bayesian A/B. Variant pool: original (ctrl) vs free-cta. 100 % traffic, 50/50 split on user_id. " +
        "Guardrails: support_chat_open, page_error.",
      createdAt: d(8),
    },
    {
      type: "note",
      title: "Exp 1 day 8 interim check",
      detail:
        "P(win)=93.1 % for free-cta. Not yet at 95 % threshold. Guardrails nominal. Continuing.",
      createdAt: d(16),
    },
    {
      type: "decision",
      title: "Decision: CONTINUE — pricing-cta-ab",
      detail:
        "free-cta reached P(win)=97.3 % after 1 060 users over 14 days. " +
        "+34.4 % lift on trial_signup_started (11.9 % → 16.0 %). All guardrails healthy. " +
        "Shipping free-cta as default. Removing 'original' variant from flag.",
      createdAt: d(21),
    },
    {
      type: "note",
      title: "Flag updated — Exp 2 variants added",
      detail:
        "'original' variant removed from pricing-page flag. " +
        "Two new challengers added: free-cta-pro (Pro plan highlighted) and free-cta-starter (Starter plan highlighted). " +
        "Exp 2 scheduled to start once flag is live with all three variants.",
      createdAt: d(23),
    },
    {
      type: "note",
      title: "Exp 2 started: pricing-highlight-bandit",
      detail:
        "Thompson Sampling bandit. Variant pool: free-cta (ctrl, no highlight) | free-cta-pro | free-cta-starter. " +
        "100 % traffic. Initial 1/3 burn-in, then dynamic reallocation. Primary metric: plan_click.",
      createdAt: d(25),
    },
    {
      type: "note",
      title: "Exp 2 bandit reweight — day 4",
      detail:
        "Thompson Sampling weights updated: free-cta=0.28, free-cta-pro=0.42, free-cta-starter=0.30. " +
        "free-cta-pro accumulating wins. Early signal only — burn-in not complete.",
      createdAt: d(29),
    },
    {
      type: "note",
      title: "Exp 2 bandit reweight — day 9",
      detail:
        "Thompson Sampling weights updated: free-cta=0.14, free-cta-pro=0.62, free-cta-starter=0.24. " +
        "P(best) for free-cta-pro = 0.891. Approaching stopping threshold.",
      createdAt: d(34),
    },
    {
      type: "decision",
      title: "Decision: CONTINUE — pricing-highlight-bandit",
      detail:
        "free-cta-pro reached P(best)=96.3 % (≥ 95 % threshold) after 680 users over 13 days. " +
        "Final weights: free-cta-pro 72 %. " +
        "Shipping free-cta-pro as permanent default. Removing free-cta-starter variant from flag.",
      createdAt: d(37),
    },
    {
      type: "note",
      title: "Flag updated — Exp 3 variant added",
      detail:
        "'free-cta-starter' variant removed from pricing-page flag. " +
        "New challenger added: free-cta-pro-social (Pro highlight + social proof section). " +
        "Exp 3 scheduled to start once flag is live with two variants.",
      createdAt: d(39),
    },
    {
      type: "note",
      title: "Exp 3 started: pricing-social-proof-ab",
      detail:
        "Bayesian A/B. Variant pool: free-cta-pro (ctrl) | free-cta-pro-social (adds 3 testimonials + 8-brand logo strip). " +
        "Sequential start — measures incremental lift on top of Exp 1+2 winners already live. " +
        "100 % traffic, 50/50 split. Minimum sample: 400/variant. Guardrails: support_chat_open, page_error.",
      createdAt: d(41),
    },
    {
      type: "note",
      title: "Exp 3 day 8 interim check",
      detail:
        "P(win)=88.4 % for free-cta-pro-social. Below 95 % threshold. 192/196 users — below minimum 400. " +
        "Guardrails nominal. Continuing.",
      createdAt: d(49),
    },
    {
      type: "note",
      title: "Exp 3 day 11 interim check",
      detail:
        "P(win)=94.7 % for free-cta-pro-social. Signal strengthening — 243/247 users, still below minimum 400. " +
        "Guardrails remain healthy. Need approx 153 more users per variant before reaching minimum sample. " +
        "Projected stopping date: ~Apr 19–22 if traffic stays constant.",
      createdAt: d(52),
    },
  ];

  for (const a of activitiesA) {
    await prisma.activity.create({
      data: { experimentId: experimentA.id, ...a },
    });
  }

  console.log(`✓ Experiment created: ${experimentA.id} — Pricing Page Optimisation`);
  console.log(`  · Exp 1  pricing-cta-ab              (Bayesian A/B, decided)   variants: original → free-cta`);
  console.log(`  · Exp 2  pricing-highlight-bandit     (Bandit,       decided)   variants: free-cta → free-cta-pro`);
  console.log(`  · Exp 3  pricing-social-proof-ab      (Bayesian A/B, collecting) variants: free-cta-pro → free-cta-pro-social`);
  console.log(`  · ${activitiesA.length} activities`);
  console.log(`\nOpen: http://localhost:3000/experiments/${experimentA.id}`);
  console.log(`\nSimulator env vars:`);
  console.log(`  FLAG_KEY=pricing-page  ENV_SECRET=pricing-env-secret-001`);
  console.log(`  SCENARIO_1_VARIANTS=free-cta-pro,free-cta-pro-social  (matches Exp 3 — currently collecting)`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
