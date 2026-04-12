/**
 * Seed: Full featbit-release-decision demo experiment
 *
 * Scenario: FeatBit dashboard help-widget optimisation
 *   - Bayesian A/B test  → help-widget-cta-v1      (CONTINUE)
 *   - Bandit experiment  → help-widget-placement-bandit (CONTINUE, bottom-right wins)
 *
 * Plus: Onboarding Flow experiment — represents a concurrent experiment
 *   that the conflict-check feature detects overlap with.
 *
 * Run:  npx tsx prisma/seed.ts
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

// ─── content constants ────────────────────────────────────────────────────────

const BAYESIAN_INPUT = JSON.stringify({
  metrics: {
    experiment_created: {
      disabled: { n: 612, k: 110 },
      "bottom-right": { n: 588, k: 148 },
    },
    page_bounce: {
      disabled: { n: 612, k: 183 },
      "bottom-right": { n: 588, k: 171 },
    },
    session_duration_p50: {
      disabled: { n: 612, mean: 247.3, variance: 7992.36 },
      "bottom-right": { n: 588, mean: 251.8, variance: 8317.44 },
    },
    support_ticket_created: {
      disabled: { n: 612, k: 24 },
      "bottom-right": { n: 588, k: 19 },
    },
  },
});

const BAYESIAN_ANALYSIS = JSON.stringify({
  type: "bayesian",
  experiment: "help-widget-cta-v1",
  computed_at: "2026-03-28T14:32:00Z",
  window: { start: "2026-03-10", end: "2026-03-28" },
  control: "disabled",
  treatments: ["bottom-right"],
  prior: "flat/improper (data-only)",
  srm: {
    chi2_p_value: 0.3142,
    ok: true,
    observed: { disabled: 612, "bottom-right": 588 },
  },
  primary_metric: {
    event: "experiment_created",
    metric_type: "proportion",
    inverse: false,
    rows: [
      { variant: "disabled", n: 612, conversions: 110, rate: 0.1797, is_control: true },
      { variant: "bottom-right", n: 588, conversions: 148, rate: 0.2517, rel_delta: 0.4012, ci_lower: 0.2381, ci_upper: 0.5643, p_win: 0.968, risk_ctrl: 0.0521, risk_trt: 0.0018, is_control: false },
    ],
    verdict: "strong signal — adopt treatment",
  },
  guardrails: [
    {
      event: "page_bounce",
      metric_type: "proportion",
      inverse: false,
      rows: [
        { variant: "disabled", n: 612, conversions: 183, rate: 0.299, is_control: true },
        { variant: "bottom-right", n: 588, conversions: 171, rate: 0.2908, rel_delta: -0.0274, ci_lower: -0.0821, ci_upper: 0.0273, p_harm: 0.294, risk_ctrl: 0.0042, risk_trt: 0.0047, is_control: false },
      ],
      verdict: "guardrail healthy (no bounce regression)",
    },
    {
      event: "session_duration_p50",
      metric_type: "continuous",
      unit: "seconds",
      inverse: false,
      rows: [
        { variant: "disabled", n: 612, mean: 247.3, is_control: true },
        { variant: "bottom-right", n: 588, mean: 251.8, rel_delta: 0.0182, ci_lower: -0.015, ci_upper: 0.052, p_decrease_gt5pct: 0.031, is_control: false },
      ],
      verdict: "guardrail healthy (session duration unaffected)",
    },
    {
      event: "support_ticket_created",
      metric_type: "proportion",
      inverse: false,
      rows: [
        { variant: "disabled", n: 612, conversions: 24, rate: 0.0392, is_control: true },
        { variant: "bottom-right", n: 588, conversions: 19, rate: 0.0323, rel_delta: -0.176, ci_lower: -0.453, ci_upper: 0.145, p_increase: 0.198, is_control: false },
      ],
      verdict: "guardrail healthy (no support-load regression)",
    },
  ],
  sample_check: {
    minimum_per_variant: 412,
    ok: true,
    variants: { disabled: 612, "bottom-right": 588 },
  },
});

const BANDIT_INPUT = JSON.stringify({
  metrics: {
    help_widget_click: {
      "bottom-right": { n: 387, k: 89 },
      "top-right": { n: 371, k: 52 },
      "inline-docs": { n: 342, k: 44 },
    },
  },
});

const BANDIT_ANALYSIS = JSON.stringify({
  type: "bandit",
  experiment: "help-widget-placement-bandit",
  computed_at: "2026-04-05T09:15:00Z",
  window: { start: "2026-03-29", end: "2026-04-05" },
  metric: "help_widget_click",
  algorithm: "Thompson Sampling (Gaussian CLT approximation)",
  srm: {
    chi2_p_value: 0.6841,
    ok: true,
    observed: { "bottom-right": 387, "top-right": 371, "inline-docs": 342 },
  },
  arms: [
    { arm: "bottom-right", n: 387, conversions: 89, rate: 0.2299 },
    { arm: "top-right", n: 371, conversions: 52, rate: 0.1402 },
    { arm: "inline-docs", n: 342, conversions: 44, rate: 0.1287 },
  ],
  thompson_sampling: {
    results: [
      { arm: "bottom-right", p_best: 0.9612, recommended_weight: 0.71 },
      { arm: "top-right", p_best: 0.0301, recommended_weight: 0.15 },
      { arm: "inline-docs", p_best: 0.0087, recommended_weight: 0.14 },
    ],
    enough_units: true,
    update_message: "successfully updated",
  },
  stopping: {
    met: true,
    best_arm: "bottom-right",
    p_best: 0.9612,
    threshold: 0.95,
    message: "bottom-right is the winning placement with 96% confidence",
  },
});

// ─── main seed ────────────────────────────────────────────────────────────────

async function main() {
  // Clean up any previous seed run
  await prisma.experiment.deleteMany({ where: { name: "Help Widget Optimisation" } });

  // ── Experiment ─────────────────────────────────────────────────────────────
  const experiment = await prisma.experiment.create({
    data: {
      name: "Help Widget Optimisation",
      description:
        "Increase new-user activation rate by surfacing contextual help at the right place in the FeatBit dashboard.",
      stage: "learning",
      flagKey: "help-widget-placement",
      envSecret: "env-secret-demo-abc123",
      flagServerUrl: "https://featbit.example.com",

      // Decision state — full cycle
      goal: "Increase the % of new users who create their first experiment within 30 days from 18% to 25%.",
      intent:
        "Surface contextual help on the feature flag list page to reduce the time new users spend figuring out how to run an experiment.",
      hypothesis:
        "If we display a pulsing help widget in the bottom-right corner of the feature flag page, and auto-expand it on first visit, then new users will create their first experiment sooner (experiment_created event), because they can find the getting-started docs without leaving the page.",
      change:
        "Add a floating HelpWidget component behind the `help-widget-placement` flag. Variants: disabled (no widget), bottom-right / top-right / inline-docs (pulsing widget with auto-expand on first visit at the corresponding screen position).",
      variants: "disabled (control — no widget) | bottom-right | top-right | inline-docs",
      primaryMetric: "experiment_created — % of new users who fire this event within their first 30 days",
      guardrails:
        "page_bounce — must not increase (widget must not distract users from their primary task)\nsession_duration_p50 — must not decrease by more than 5% (widget must not shorten user sessions)\nsupport_ticket_created — must not increase (widget should reduce, not increase, support load)",
      constraints:
        "Widget must not affect users who already created an experiment. Flag evaluation limited to accounts created in the last 30 days.",
      conflictAnalysis:
        "✅ No Direct Conflicts Found\n\n" +
        "Active experiments scanned: 1 (Onboarding Flow Optimization — measuring stage).\n\n" +
        "• Flag overlap: None — this experiment uses `help-widget-placement`, the other uses `onboarding-checklist-flow`.\n" +
        "• Metric interference: None — this experiment measures `experiment_created`, the other measures `onboarding_step_completed`.\n" +
        "• Audience overlap: Both target new users (accounts < 30 days), but the flag keys and metrics are independent — no attribution risk.\n\n" +
        "Summary: Safe to proceed. No mutual-exclusion layer required.",
      openQuestions: "",
      lastAction:
        "Set help-widget-placement=bottom-right for all new users after two experiments confirmed: (1) widget boosts activation, (2) bottom-right is the optimal placement.",
      lastLearning:
        "Auto-expanding the help widget on first visit increased experiment_created by +40%. Bottom-right placement outperforms top-right and inline-docs by 8–10 percentage points on click-through.",
    },
  });

  // ── Experiment Run 1 — Bayesian A/B ───────────────────────────────────────
  await prisma.experimentRun.create({
    data: {
      experimentId: experiment.id,
      slug: "help-widget-cta-v1",
      status: "decided",

      hypothesis:
        "If we display a pulsing help widget in the bottom-right corner of the feature flag page, and auto-expand it on first visit, then new users will create their first experiment sooner (experiment_created event), because they can find the getting-started docs without leaving the page.",
      method: "bayesian_ab",
      methodReason:
        "We need a rigorous comparison between control (no widget) and treatment (pulsing widget) with full posterior distributions. The decision stakes are high — this changes the default experience for all new users. Bayesian A/B gives us P(win), credible intervals, and risk estimates so we can make a confident binary ship/no-ship decision. A bandit is unnecessary because we only have two variants and can afford a fixed 50/50 split during the observation window.",
      primaryMetricEvent: "experiment_created",
      metricDescription:
        "Percentage of new users (accounts < 30 days) who fire the experiment_created event within their first 30 days. This is the north-star activation metric.",
      guardrailEvents: JSON.stringify(["page_bounce", "session_duration_p50", "support_ticket_created"]),
      guardrailDescriptions: JSON.stringify({
        page_bounce: "Must not increase — the widget must not distract users from their primary task on the flag list page.",
        session_duration_p50: "Must not decrease by more than 5% — the widget must not shorten user sessions.",
        support_ticket_created: "Must not increase — the widget should reduce, not increase, support load.",
      }),
      controlVariant: "disabled",
      treatmentVariant: "bottom-right",
      trafficAllocation:
        "Dispatch key: user_id (sticky). 50/50 random split via feature flag help-widget-placement. Control arm serves variant 'disabled' (no widget rendered). Treatment arm serves 'bottom-right'. Users are stained on first exposure — variant assignment persists for the lifetime of the experiment.",
      minimumSample: 412,
      observationStart: d(9),   // 2026-03-10
      observationEnd: d(27),    // 2026-03-28
      priorProper: false,
      priorMean: 0.0,
      priorStddev: 0.3,

      inputData: BAYESIAN_INPUT,
      analysisResult: BAYESIAN_ANALYSIS,

      decision: "CONTINUE",
      decisionSummary:
        "Recommend enabling the help widget for all new users — set help-widget-placement to bottom-right.",
      decisionReason:
        "P(win)=96.8% for the treatment arm, well above the 95% threshold. Relative lift of +40% on experiment_created with no guardrail regression. All three guardrails passed: page_bounce P(harm)=29.4% (bounce rate −2.7%, CI crosses zero — healthy), session_duration_p50 P(↓>5%)=3.1% (duration unchanged — healthy), support_ticket_created P(increase)=19.8% (ticket rate −17.6%, CI crosses zero — healthy). Both arms exceeded minimum sample.",

      whatChanged:
        "Added floating HelpWidget component with pulsing animation and auto-expand on first visit, served behind the `help-widget-placement` feature flag (disabled vs bottom-right).",
      whatHappened:
        "experiment_created rate increased from 17.97% to 25.17% (+40% relative lift) across 1200 new users over 18 days. All guardrails held: page bounce rate unchanged (−2.7%, P(harm)=29.4%), session duration unaffected (+1.8%, P(↓>5%)=3.1%), support ticket rate slightly lower (−17.6%, P(increase)=19.8%).",
      confirmedOrRefuted:
        "CONFIRMED — the hypothesis held. Auto-expanding contextual help does accelerate first-experiment creation for new users.",
      whyItHappened:
        "New users were abandoning the flag list page to search for docs externally. The widget removed that friction by keeping help in-context. Auto-expand on first visit ensured discoverability without requiring an extra click.",
      nextHypothesis:
        "Widget placement may further affect engagement. Run a bandit across the remaining help-widget-placement variants (bottom-right vs top-right vs inline-docs) to find the optimal position.",
    },
  } as Parameters<typeof prisma.experimentRun.create>[0]);

  // ── Experiment Run 2 — Bandit ─────────────────────────────────────────────
  await prisma.experimentRun.create({
    data: {
      experimentId: experiment.id,
      slug: "help-widget-placement-bandit",
      status: "decided",

      hypothesis:
        "Widget placement (bottom-right vs top-right vs inline-docs) affects click-through. Bottom-right follows established UI conventions and will outperform the other two placements on help_widget_click.",
      method: "bandit",
      methodReason:
        "We have 3 placement arms and the goal is to find the winner fast while minimizing opportunity cost. A fixed A/B split would waste traffic on clearly inferior arms. Thompson Sampling dynamically shifts traffic toward the best-performing arm, so we converge faster and expose fewer users to bad placements. The metric (help_widget_click) is a fast signal — click or no-click within a session — making it ideal for a bandit's rapid reallocation loop.",
      primaryMetricEvent: "help_widget_click",
      metricDescription:
        "Whether a user clicks the help widget during their session. This is the fast-signal proxy metric for widget engagement — it tells us which placement is most discoverable.",
      guardrailEvents: JSON.stringify([]),
      guardrailDescriptions: JSON.stringify({}),
      controlVariant: "bottom-right",
      treatmentVariant: "top-right | inline-docs",
      trafficAllocation:
        "Dispatch key: user_id (sticky). Thompson Sampling reallocation via feature flag help-widget-placement. Initial split: 34/33/33 across bottom-right, top-right, inline-docs. Traffic is reallocated daily based on posterior probability of each arm being best. Users are re-randomised at each reallocation epoch — bandit prioritises convergence over individual consistency.",
      minimumSample: 100,
      observationStart: d(28),  // 2026-03-29
      observationEnd: d(35),    // 2026-04-05
      priorProper: false,
      priorMean: 0.0,
      priorStddev: 0.3,

      inputData: BANDIT_INPUT,
      analysisResult: BANDIT_ANALYSIS,

      decision: "CONTINUE",
      decisionSummary:
        "Recommend setting help-widget-placement to bottom-right permanently for all new users.",
      decisionReason:
        "Thompson Sampling gave bottom-right P(best)=96.1%, exceeding the 95% stopping threshold after 7 days and 1100 users. bottom-right click rate (23.0%) outperforms top-right (14.0%) and inline-docs (12.9%) by 8–10 percentage points. Allocated 71% of traffic to bottom-right during the bandit run.",

      whatChanged:
        "Ran a three-arm Thompson Sampling bandit across bottom-right, top-right, and inline-docs widget placements. Traffic was dynamically reallocated daily as data accumulated.",
      whatHappened:
        "bottom-right quickly dominated. By day 7 it held 71% of traffic and achieved P(best)=96.1%. top-right and inline-docs plateaued at 14% and 13% click rates respectively.",
      confirmedOrRefuted:
        "CONFIRMED — bottom-right outperformed both alternatives, consistent with established UI convention (users expect action items in the bottom-right corner).",
      whyItHappened:
        "Users are conditioned to expect help and support CTAs in the bottom-right by tools like Intercom and Crisp. Top-right conflicts with navigation elements. Inline-docs placement is too far down the page to be noticed on initial scroll.",
      nextHypothesis:
        "Now that placement is fixed at bottom-right, test expanding vs collapsed default state for returning users who have already created one experiment — they may prefer a less intrusive widget.",
    },
  } as Parameters<typeof prisma.experimentRun.create>[0]);

  // ── Activities — full experiment timeline ─────────────────────────────────
  const activities = [
    {
      type: "stage_change",
      title: "Experiment created",
      detail: 'Release decision experiment "Help Widget Optimisation" created. Stage: intent',
      createdAt: d(0),
    },
    {
      type: "note",
      title: "Intent captured",
      detail: "Goal: increase new users creating their first experiment within 30 days from 18% → 25%. Intent: contextual in-page help on the flag list page.",
      createdAt: d(0),
    },
    {
      type: "stage_change",
      title: "Stage changed to hypothesis",
      detail: "Hypothesis: pulsing help widget with auto-expand → more experiment_created events. Guardrail: page_bounce must not increase.",
      createdAt: d(1),
    },
    {
      type: "stage_change",
      title: "Stage changed to implementing",
      detail: "HelpWidget component added behind `help-widget-placement` flag. Variants: disabled (no widget) | bottom-right | top-right | inline-docs. Two experiments planned in sequence: (1) Bayesian A/B — disabled vs bottom-right, to validate the widget helps; (2) Bandit — bottom-right vs top-right vs inline-docs, to optimise placement. Sequential design chosen because both experiments share one flag and one user pool — running them concurrently would require mutual-exclusion layers, adding complexity without benefit. Exp 2 starts only after Exp 1 concludes. Exp 1 traffic allocation: 50/50 split between disabled and bottom-right. Dispatch key: userId. Only new users (accounts < 30 days) enter the experiment; existing users excluded. Remaining variants (top-right, inline-docs) are reserved for Exp 2.",
      createdAt: d(3),
    },
    {
      type: "note",
      title: "Flag configured",
      detail: "Flag key: help-widget-placement. Env secret and server URL set. SDK integrated with experiment_created and page_bounce track() calls. Four variants configured: disabled, bottom-right, top-right, inline-docs.",
      createdAt: d(4),
    },
    {
      type: "stage_change",
      title: "Stage changed to measuring",
      detail: "Observation window open: 2026-03-10. Minimum sample per variant: 412 (based on 18% baseline, 80% power, 5% MDE).",
      createdAt: d(9),
    },
    {
      type: "note",
      title: "Experiment started: help-widget-cta-v1",
      detail: "Bayesian A/B experiment created. Primary metric: experiment_created. Guardrail: page_bounce. Prior: flat (data-only).",
      createdAt: d(9),
    },
    {
      type: "note",
      title: "Sample check passed",
      detail: "Day 12: disabled=301 users, bottom-right=289 users. Both above burn-in floor. Continuing observation.",
      createdAt: d(12),
    },
    {
      type: "note",
      title: "Analysis run — day 18",
      detail: "P(win)=94.1% for treatment. Not yet above 95% threshold. Continuing.",
      createdAt: d(18),
    },
    {
      type: "note",
      title: "Analysis run — day 27 (final)",
      detail: "P(win)=96.8% ✓ — stopping condition met. Guardrail page_bounce: P(win)=29.4% — healthy.",
      createdAt: d(27),
    },
    {
      type: "stage_change",
      title: "Stage advanced to measuring (deciding phase)",
      detail: "Both arms above minimum sample. P(win)=96.8% for treatment. Guardrail healthy. Evidence sufficient.",
      createdAt: d(27),
    },
    {
      type: "decision",
      title: "Decision: CONTINUE — help-widget-cta-v1",
      detail: "Help widget confirmed effective. Relative lift +40% on experiment_created. Proceeding to placement bandit.",
      createdAt: d(28),
    },
    {
      type: "note",
      title: "Bandit started: help-widget-placement-bandit",
      detail: "Exp 2 begins after Exp 1 concluded on day 27. Traffic allocation change: the disabled variant is removed — all new users now see the widget (Exp 1 confirmed it helps). Three-arm Thompson Sampling bandit across bottom-right, top-right, inline-docs. Initial allocation: equal 1/3 split during burn-in (100 users/arm), then dynamic reallocation by Thompson Sampling to minimise regret. Primary metric: help_widget_click. No mutual-exclusion layer needed because Exp 1 is fully concluded.",
      createdAt: d(28),
    },
    {
      type: "note",
      title: "Bandit reweight — day 3",
      detail: "Weights updated: bottom-right=0.51, top-right=0.28, inline-docs=0.21. bottom-right pulling ahead.",
      createdAt: d(31),
    },
    {
      type: "note",
      title: "Bandit reweight — day 5",
      detail: "Weights updated: bottom-right=0.63, top-right=0.21, inline-docs=0.16. P(best) bottom-right = 0.88.",
      createdAt: d(33),
    },
    {
      type: "note",
      title: "Bandit reweight — day 7 (final)",
      detail: "P(best) bottom-right = 0.961 ✓ ≥ 0.95 — stopping condition met. Weights: bottom-right=0.71.",
      createdAt: d(35),
    },
    {
      type: "decision",
      title: "Decision: CONTINUE — help-widget-placement-bandit",
      detail: "help-widget-placement set to bottom-right for all new users. Feature flag locked to winning variant.",
      createdAt: d(35),
    },
    {
      type: "stage_change",
      title: "Stage changed to learning",
      detail: "Both experiments closed. Learnings captured. Activation rate target 25% confirmed by data.",
      createdAt: d(36),
    },
    {
      type: "note",
      title: "Learning captured",
      detail: "Next hypothesis: collapsed vs expanded default for returning users who have already created one experiment.",
      createdAt: d(36),
    },
  ];

  for (const a of activities) {
    await prisma.activity.create({
      data: { experimentId: experiment.id, ...a },
    });
  }

  console.log(`✓ Experiment created: ${experiment.id}`);
  console.log(`✓ 2 experiment runs seeded (Bayesian A/B + Bandit)`);
  console.log(`✓ ${activities.length} activities seeded`);
  console.log(`\nOpen: http://localhost:3000/experiments/${experiment.id}`);

  // ── Second Experiment: Onboarding Flow (concurrent — used for conflict demo) ──

  await prisma.experiment.deleteMany({ where: { name: "Onboarding Flow Optimization" } });

  const onboarding = await prisma.experiment.create({
    data: {
      name: "Onboarding Flow Optimization",
      description:
        "Optimize the onboarding checklist to increase completion rate for new users.",
      stage: "measuring",
      flagKey: "onboarding-checklist-flow",
      envSecret: "env-secret-demo-abc123",
      flagServerUrl: "https://featbit.example.com",

      goal: "Increase the % of new users who complete the onboarding checklist within 7 days from 35% to 50%.",
      intent:
        "Redesign the onboarding checklist to be more progressive and less overwhelming for new users.",
      hypothesis:
        "If we break the onboarding checklist into 3 progressive tiers instead of showing all 8 steps at once, then new users will complete more steps (onboarding_step_completed) because the initial task list feels achievable rather than overwhelming.",
      change:
        "Replace the flat 8-step checklist with a 3-tier progressive checklist behind the `onboarding-checklist-flow` flag. Variants: flat (control — all 8 steps visible) | progressive (3 tiers revealed sequentially).",
      variants: "flat (control — all 8 steps) | progressive (3 tiers)",
      primaryMetric: "onboarding_step_completed — % of new users who complete all checklist steps within 7 days",
      guardrails:
        "time_to_first_action — must not increase by more than 10% (progressive reveal must not slow users down)\nsupport_ticket_created — must not increase (new flow must not confuse users)",
      constraints:
        "Only affects new users (accounts created in the last 30 days). Users who completed onboarding are excluded.",
      conflictAnalysis:
        "⚠️ 1 Potential Conflict Detected\n\n" +
        "Conflict with: Help Widget Optimisation (measuring stage)\n\n" +
        "• Flag overlap: None — different flags (`onboarding-checklist-flow` vs `help-widget-placement`).\n" +
        "• Metric interference: None — different primary metrics (`onboarding_step_completed` vs `experiment_created`).\n" +
        "• Audience overlap: Both target new users (accounts < 30 days). Users may be enrolled in both experiments simultaneously.\n\n" +
        "Risk level: LOW — although the audiences overlap, the flags and metrics are independent. " +
        "A user seeing the help widget will not affect whether they complete onboarding steps, and vice versa. " +
        "No mutual-exclusion layer is required.\n\n" +
        "Recommendation: Proceed. Monitor for unexpected interaction effects in guardrails.",
      openQuestions: "",
      lastAction: "Started Bayesian A/B run on 2026-03-15.",
    },
  });

  await prisma.experimentRun.create({
    data: {
      experimentId: onboarding.id,
      slug: "onboarding-progressive-v1",
      status: "running",
      hypothesis:
        "3-tier progressive checklist will increase onboarding completion rate from 35% to 50%.",
      method: "bayesian_ab",
      methodReason:
        "Binary ship/no-ship decision with two variants. Need full posterior for confident decision.",
      primaryMetricEvent: "onboarding_step_completed",
      metricDescription:
        "Percentage of new users who complete all onboarding checklist steps within 7 days.",
      guardrailEvents: JSON.stringify(["time_to_first_action", "support_ticket_created"]),
      guardrailDescriptions: JSON.stringify({
        time_to_first_action: "Must not increase by more than 10%.",
        support_ticket_created: "Must not increase.",
      }),
      controlVariant: "flat",
      treatmentVariant: "progressive",
      trafficAllocation:
        "50/50 split between flat and progressive. Dispatch key: user_id. Only new users (accounts < 30 days).",
      minimumSample: 350,
      observationStart: d(14),  // 2026-03-15
      observationEnd: d(35),    // 2026-04-05
      priorProper: false,
    },
  } as Parameters<typeof prisma.experimentRun.create>[0]);

  await prisma.activity.create({
    data: {
      experimentId: onboarding.id,
      type: "stage_change",
      title: "Experiment created",
      detail: 'Release decision experiment "Onboarding Flow Optimization" created. Stage: intent',
      createdAt: d(5),
    },
  });
  await prisma.activity.create({
    data: {
      experimentId: onboarding.id,
      type: "stage_change",
      title: "Stage changed to measuring",
      detail: "Observation window open: 2026-03-15. Running onboarding-progressive-v1.",
      createdAt: d(14),
    },
  });

  console.log(`✓ Onboarding experiment created: ${onboarding.id}`);
  console.log(`  Open: http://localhost:3000/experiments/${onboarding.id}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
