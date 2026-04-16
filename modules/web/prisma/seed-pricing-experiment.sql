-- ============================================================================
-- Seed: Pricing Page Conversion Experiment
--
-- Realistic scenario: FeatBit team tests whether a redesigned pricing page
-- with social proof badges and simplified tier comparison increases the rate
-- at which free-trial users select a paid plan.
--
-- Usage:
--   docker exec featbit-release-decision-agent-postgres-1 \
--     psql -U postgres -d release_decision -f /dev/stdin < prisma/seed-pricing-experiment.sql
-- ============================================================================

BEGIN;

-- ── Experiment record ────────────────────────────────────────────────────────

INSERT INTO experiment (
  id, name, description, stage,
  flag_key, env_secret, flag_server_url,
  goal, intent, hypothesis, change, variants,
  primary_metric, guardrails, constraints,
  conflict_analysis, open_questions, last_action,
  created_at, updated_at
) VALUES (
  'pricing-page-exp-001',
  'Pricing Page Conversion',
  'Test whether a redesigned pricing page with social proof badges, annual/monthly toggle, and simplified 3-tier comparison increases the free-trial to paid-plan conversion rate.',
  'measuring',
  'pricing-page-redesign',
  'pricing-env-secret-001',
  'https://app.featbit.co',

  -- goal
  'Increase the percentage of free-trial users who select a paid plan within 14 days from 8.5% to 12%.',

  -- intent
  'Many trial users visit the pricing page but leave without selecting a plan. We believe the current layout is too complex (5 tiers, no social proof, no annual savings highlight) and creates decision paralysis.',

  -- hypothesis
  'If we simplify the pricing page to 3 clear tiers with social proof badges ("2,000+ teams trust FeatBit") and a prominent annual/monthly toggle showing savings, then more free-trial users will select a paid plan (plan_selected event) within 14 days, because reduced cognitive load and trust signals lower the barrier to purchase.',

  -- change
  'Replace the 5-tier pricing grid with a 3-tier card layout behind the `pricing-page-redesign` feature flag. Treatment adds: (1) social proof banner, (2) annual/monthly toggle with "Save 20%" badge, (3) "Most Popular" highlight on the Pro tier, (4) feature comparison tooltip on hover.',

  -- variants
  'original (control — current 5-tier grid) | redesigned (3-tier cards + social proof)',

  -- primary_metric
  'plan_selected — percentage of free-trial users who fire this event within 14 days of first pricing page visit',

  -- guardrails
  'pricing_page_bounce — must not increase by more than 3pp (redesign must not drive users away faster)
support_chat_opened — must not increase (simplified layout should reduce confusion, not increase it)
page_load_time_ms — must not increase by more than 200ms (additional assets must not degrade performance)',

  -- constraints
  'Only free-trial users (no existing paid subscribers). Users who already selected a plan are excluded from re-entry.',

  -- conflict_analysis
  '✅ No Conflicts Detected

Active experiments scanned: 2 (Help Widget Optimisation — learning, Onboarding Flow — measuring).

• Flag overlap: None — this experiment uses `pricing-page-redesign`, others use `help-widget-placement` and `onboarding-checklist-flow`.
• Metric interference: None — `plan_selected` is not measured by any other active experiment.
• Audience overlap: Minimal — this targets free-trial users on the pricing page; onboarding targets new users in the dashboard.

Summary: Safe to proceed without mutual-exclusion layers.',

  -- open_questions
  '',

  -- last_action
  'Bayesian A/B run started on 2026-04-01. Observation window: 14 days. Minimum sample: 400/variant.',

  NOW(), NOW()
)
ON CONFLICT (id) DO UPDATE SET
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  stage = EXCLUDED.stage,
  flag_key = EXCLUDED.flag_key,
  env_secret = EXCLUDED.env_secret,
  updated_at = NOW();


-- ── Experiment Run ───────────────────────────────────────────────────────────

INSERT INTO experiment_run (
  id, experiment_id, slug, status,
  hypothesis, method, method_reason,
  primary_metric_event, primary_metric_type, primary_metric_agg,
  metric_description,
  guardrail_events, guardrail_descriptions,
  control_variant, treatment_variant,
  traffic_allocation, traffic_percent, minimum_sample,
  observation_start, observation_end,
  prior_proper, prior_mean, prior_stddev,
  created_at, updated_at
) VALUES (
  'pricing-run-001',
  'pricing-page-exp-001',
  'pricing-redesign-v1',
  'running',

  -- hypothesis
  'Simplifying the pricing page from 5 tiers to 3 tiers with social proof badges will increase plan_selected conversion rate from 8.5% to 12%+.',

  -- method + reason
  'bayesian_ab',
  'Binary ship/no-ship decision between original and redesigned pricing page. Full posterior distribution needed to quantify conversion lift and risk. Two variants with 50/50 fixed allocation — no need for a bandit.',

  -- metric config
  'plan_selected',
  'binary',
  'once',
  'Whether a free-trial user selects any paid plan within 14 days of their first pricing page visit. Fired once per user (de-duplicated by user_key).',

  -- guardrails
  '["pricing_page_bounce", "support_chat_opened"]',
  '{"pricing_page_bounce": "Must not increase by more than 3 percentage points — the redesign must not drive users away.", "support_chat_opened": "Must not increase — a simpler layout should reduce confusion."}',

  -- variants
  'original',
  'redesigned',

  -- traffic
  '50/50 split. Dispatch key: user_id (sticky). Free-trial users only.',
  100,
  400,

  -- observation window
  '2026-04-01T00:00:00Z',
  '2026-04-14T23:59:59Z',

  -- priors
  false,
  0.085,
  0.3,

  NOW(), NOW()
)
ON CONFLICT (experiment_id, slug) DO UPDATE SET
  status = EXCLUDED.status,
  updated_at = NOW();


-- ── Activity timeline ────────────────────────────────────────────────────────

DELETE FROM activity WHERE experiment_id = 'pricing-page-exp-001';

INSERT INTO activity (id, experiment_id, type, title, detail, created_at) VALUES
  (gen_random_uuid(), 'pricing-page-exp-001', 'stage_change',
   'Experiment created',
   'Release decision experiment "Pricing Page Conversion" created. Stage: intent.',
   '2026-03-25T10:00:00Z'),

  (gen_random_uuid(), 'pricing-page-exp-001', 'note',
   'Intent captured',
   'Goal: increase free-trial → paid conversion from 8.5% to 12% within 14 days. Current pricing page has 5 tiers and no social proof — suspected decision paralysis.',
   '2026-03-25T10:30:00Z'),

  (gen_random_uuid(), 'pricing-page-exp-001', 'stage_change',
   'Stage changed to hypothesis',
   'Hypothesis: 3-tier layout + social proof + annual savings toggle → more plan_selected events. Guardrails: pricing_page_bounce, support_chat_opened, page_load_time_ms.',
   '2026-03-26T09:00:00Z'),

  (gen_random_uuid(), 'pricing-page-exp-001', 'stage_change',
   'Stage changed to implementing',
   'Feature flag `pricing-page-redesign` created with two variants: original (control) and redesigned (treatment). SDK integrated with plan_selected, pricing_page_bounce, and support_chat_opened track() calls. Staging QA passed.',
   '2026-03-28T14:00:00Z'),

  (gen_random_uuid(), 'pricing-page-exp-001', 'note',
   'Flag configured & QA complete',
   'Flag key: pricing-page-redesign. Env secret set. 3-tier card layout renders correctly on desktop/tablet/mobile. Social proof badge loads from CDN with <50ms overhead. Annual toggle saves state in localStorage.',
   '2026-03-29T11:00:00Z'),

  (gen_random_uuid(), 'pricing-page-exp-001', 'stage_change',
   'Stage changed to measuring',
   'Observation window open: 2026-04-01. Minimum sample per variant: 400 (based on 8.5% baseline, 80% power, 3.5pp MDE for absolute lift).',
   '2026-04-01T00:00:00Z'),

  (gen_random_uuid(), 'pricing-page-exp-001', 'note',
   'Experiment started: pricing-redesign-v1',
   'Bayesian A/B experiment created. Primary metric: plan_selected (binary, once). Guardrails: pricing_page_bounce, support_chat_opened. Prior: informative (mean=0.085, σ=0.3). 50/50 split.',
   '2026-04-01T00:05:00Z'),

  (gen_random_uuid(), 'pricing-page-exp-001', 'note',
   'Day 3 check-in',
   'Control: 142 users, 11 conversions (7.7%). Treatment: 138 users, 17 conversions (12.3%). Too early — below minimum sample. Continuing.',
   '2026-04-04T09:00:00Z'),

  (gen_random_uuid(), 'pricing-page-exp-001', 'note',
   'Day 7 check-in',
   'Control: 312 users, 27 conversions (8.7%). Treatment: 305 users, 41 conversions (13.4%). Approaching minimum sample. P(treatment > control) = 91.2%. Not yet above 95% threshold.',
   '2026-04-08T09:00:00Z'),

  (gen_random_uuid(), 'pricing-page-exp-001', 'note',
   'Day 10 mid-point',
   'Control: 421 users, 36 conversions (8.6%). Treatment: 415 users, 55 conversions (13.3%). Both arms above minimum sample (400). P(treatment > control) = 94.1%. Almost there.',
   '2026-04-11T09:00:00Z');


-- ══════════════════════════════════════════════════════════════════════════════
-- Seed flag evaluations and metric events
--
-- Generates ~1200 users (600 per variant) over April 1-13, 2026
-- Control conversion rate: ~8.5%  |  Treatment conversion rate: ~13.5%
-- ══════════════════════════════════════════════════════════════════════════════

-- ── Flag Evaluations (1200 users) ────────────────────────────────────────────
-- Each user gets one flag evaluation when they land on the pricing page.

INSERT INTO flag_evaluations (
  env_id, flag_key, user_key, variant, experiment_id, evaluated_at, session_id
)
SELECT
  'pricing-env-secret-001',
  'pricing-page-redesign',
  'user-pricing-' || LPAD(n::text, 5, '0'),
  CASE WHEN n <= 600 THEN 'original' ELSE 'redesigned' END,
  'pricing-page-exp-001',
  -- Spread evaluations across April 1-13
  '2026-04-01T00:00:00Z'::timestamptz
    + (((n - 1) % 13) || ' days')::interval
    + ((n * 37 % 1440) || ' minutes')::interval,
  'sess-pricing-' || LPAD(n::text, 5, '0')
FROM generate_series(1, 1200) AS n;


-- ── Primary Metric: plan_selected (binary conversion events) ─────────────────
-- Control: ~51 out of 600 ≈ 8.5% conversion
-- Treatment: ~81 out of 600 ≈ 13.5% conversion

-- Control conversions (users 1-600, pick ~51 users deterministically)
INSERT INTO metric_events (
  env_id, event_name, user_key, numeric_value, occurred_at, session_id, source
)
SELECT
  'pricing-env-secret-001',
  'plan_selected',
  'user-pricing-' || LPAD(n::text, 5, '0'),
  1.0,
  -- Conversion happens 2-30 minutes after the flag eval
  '2026-04-01T00:00:00Z'::timestamptz
    + (((n - 1) % 13) || ' days')::interval
    + ((n * 37 % 1440) || ' minutes')::interval
    + ((n * 13 % 28 + 2) || ' minutes')::interval,
  'sess-pricing-' || LPAD(n::text, 5, '0'),
  'web'
FROM generate_series(1, 600) AS n
WHERE
  -- Deterministic selection: hash-like using modular arithmetic → ~8.5% = 51/600
  (n * 7 + 3) % 100 < 9;    -- yields ~54 rows out of 600 (~9%)

-- Treatment conversions (users 601-1200, pick ~81 users)
INSERT INTO metric_events (
  env_id, event_name, user_key, numeric_value, occurred_at, session_id, source
)
SELECT
  'pricing-env-secret-001',
  'plan_selected',
  'user-pricing-' || LPAD(n::text, 5, '0'),
  1.0,
  '2026-04-01T00:00:00Z'::timestamptz
    + (((n - 1) % 13) || ' days')::interval
    + ((n * 37 % 1440) || ' minutes')::interval
    + ((n * 13 % 28 + 2) || ' minutes')::interval,
  'sess-pricing-' || LPAD(n::text, 5, '0'),
  'web'
FROM generate_series(601, 1200) AS n
WHERE
  -- ~13.5% = 81/600
  (n * 7 + 3) % 100 < 14;   -- yields ~84 rows out of 600 (~14%)


-- ── Guardrail 1: pricing_page_bounce ─────────────────────────────────────────
-- Control bounce rate: ~35%  |  Treatment bounce rate: ~33% (slight improvement)

-- Control bounces
INSERT INTO metric_events (
  env_id, event_name, user_key, numeric_value, occurred_at, session_id, source
)
SELECT
  'pricing-env-secret-001',
  'pricing_page_bounce',
  'user-pricing-' || LPAD(n::text, 5, '0'),
  1.0,
  '2026-04-01T00:00:00Z'::timestamptz
    + (((n - 1) % 13) || ' days')::interval
    + ((n * 37 % 1440) || ' minutes')::interval
    + '15 seconds'::interval,
  'sess-pricing-' || LPAD(n::text, 5, '0'),
  'web'
FROM generate_series(1, 600) AS n
WHERE (n * 11 + 5) % 100 < 35;

-- Treatment bounces
INSERT INTO metric_events (
  env_id, event_name, user_key, numeric_value, occurred_at, session_id, source
)
SELECT
  'pricing-env-secret-001',
  'pricing_page_bounce',
  'user-pricing-' || LPAD(n::text, 5, '0'),
  1.0,
  '2026-04-01T00:00:00Z'::timestamptz
    + (((n - 1) % 13) || ' days')::interval
    + ((n * 37 % 1440) || ' minutes')::interval
    + '15 seconds'::interval,
  'sess-pricing-' || LPAD(n::text, 5, '0'),
  'web'
FROM generate_series(601, 1200) AS n
WHERE (n * 11 + 5) % 100 < 33;


-- ── Guardrail 2: support_chat_opened ─────────────────────────────────────────
-- Control: ~4.5%  |  Treatment: ~3.8% (slight improvement — less confusion)

-- Control support chats
INSERT INTO metric_events (
  env_id, event_name, user_key, numeric_value, occurred_at, session_id, source
)
SELECT
  'pricing-env-secret-001',
  'support_chat_opened',
  'user-pricing-' || LPAD(n::text, 5, '0'),
  1.0,
  '2026-04-01T00:00:00Z'::timestamptz
    + (((n - 1) % 13) || ' days')::interval
    + ((n * 37 % 1440) || ' minutes')::interval
    + ((n * 17 % 10 + 1) || ' minutes')::interval,
  'sess-pricing-' || LPAD(n::text, 5, '0'),
  'web'
FROM generate_series(1, 600) AS n
WHERE (n * 13 + 7) % 100 < 5;

-- Treatment support chats
INSERT INTO metric_events (
  env_id, event_name, user_key, numeric_value, occurred_at, session_id, source
)
SELECT
  'pricing-env-secret-001',
  'support_chat_opened',
  'user-pricing-' || LPAD(n::text, 5, '0'),
  1.0,
  '2026-04-01T00:00:00Z'::timestamptz
    + (((n - 1) % 13) || ' days')::interval
    + ((n * 37 % 1440) || ' minutes')::interval
    + ((n * 17 % 10 + 1) || ' minutes')::interval,
  'sess-pricing-' || LPAD(n::text, 5, '0'),
  'web'
FROM generate_series(601, 1200) AS n
WHERE (n * 13 + 7) % 100 < 4;


-- ── Verify ───────────────────────────────────────────────────────────────────

DO $$
DECLARE
  fe_count  BIGINT;
  me_count  BIGINT;
  ctrl_conv BIGINT;
  trt_conv  BIGINT;
  ctrl_n    BIGINT;
  trt_n     BIGINT;
BEGIN
  SELECT count(*) INTO fe_count
  FROM flag_evaluations WHERE experiment_id = 'pricing-page-exp-001';

  SELECT count(*) INTO me_count
  FROM metric_events WHERE env_id = 'pricing-env-secret-001';

  SELECT count(*) INTO ctrl_n
  FROM flag_evaluations WHERE experiment_id = 'pricing-page-exp-001' AND variant = 'original';

  SELECT count(*) INTO trt_n
  FROM flag_evaluations WHERE experiment_id = 'pricing-page-exp-001' AND variant = 'redesigned';

  SELECT count(*) INTO ctrl_conv
  FROM metric_events me
  JOIN flag_evaluations fe ON fe.user_key = me.user_key AND fe.env_id = me.env_id
  WHERE me.event_name = 'plan_selected'
    AND me.env_id = 'pricing-env-secret-001'
    AND fe.variant = 'original';

  SELECT count(*) INTO trt_conv
  FROM metric_events me
  JOIN flag_evaluations fe ON fe.user_key = me.user_key AND fe.env_id = me.env_id
  WHERE me.event_name = 'plan_selected'
    AND me.env_id = 'pricing-env-secret-001'
    AND fe.variant = 'redesigned';

  RAISE NOTICE '';
  RAISE NOTICE '══════════════════════════════════════════════════';
  RAISE NOTICE '  Pricing Page Conversion — Seed Summary';
  RAISE NOTICE '══════════════════════════════════════════════════';
  RAISE NOTICE '  Flag evaluations:  %', fe_count;
  RAISE NOTICE '  Metric events:     %', me_count;
  RAISE NOTICE '  ──────────────────────────────────────────────';
  RAISE NOTICE '  Control (original):    % users, % conversions (% %%)',
    ctrl_n, ctrl_conv, ROUND(ctrl_conv::numeric / GREATEST(ctrl_n, 1) * 100, 1);
  RAISE NOTICE '  Treatment (redesigned): % users, % conversions (% %%)',
    trt_n, trt_conv, ROUND(trt_conv::numeric / GREATEST(trt_n, 1) * 100, 1);
  RAISE NOTICE '══════════════════════════════════════════════════';
  RAISE NOTICE '';
END $$;

COMMIT;
