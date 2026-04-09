-- ============================================================================
-- Product Analytics Query Patterns on metric_events
--
-- Assumptions:
--   - metric_events is the single raw event table for both experiment metrics
--     and general analytics events.
--   - env_id scopes a product environment / workspace.
--   - user_key is the canonical analysis identity. If your product uses
--     anonymous_id or account_id as the analysis grain, swap that in.
--   - occurred_at is the event time used for business analysis.
--
-- Notes:
--   - These are reference patterns, not final production queries.
--   - For high-volume workloads, build derived daily/session tables or
--     materialized views on top of these raw queries.
-- ============================================================================


-- --------------------------------------------------------------------------
-- 1. Funnel conversion by user
--
-- Example funnel:
--   view_pricing  ->  start_checkout  ->  purchase_completed
--
-- Returns per-step unique users and step-to-step conversion rates.
-- --------------------------------------------------------------------------
WITH step1 AS (
  SELECT user_key, MIN(occurred_at) AS step1_at
  FROM metric_events
  WHERE env_id = $1
    AND event_name = 'view_pricing'
    AND occurred_at BETWEEN $2 AND $3
  GROUP BY user_key
),
step2 AS (
  SELECT me.user_key, MIN(me.occurred_at) AS step2_at
  FROM metric_events me
  JOIN step1 s1 ON s1.user_key = me.user_key
  WHERE me.env_id = $1
    AND me.event_name = 'start_checkout'
    AND me.occurred_at >= s1.step1_at
    AND me.occurred_at BETWEEN $2 AND $3
  GROUP BY me.user_key
),
step3 AS (
  SELECT me.user_key, MIN(me.occurred_at) AS step3_at
  FROM metric_events me
  JOIN step2 s2 ON s2.user_key = me.user_key
  WHERE me.env_id = $1
    AND me.event_name = 'purchase_completed'
    AND me.occurred_at >= s2.step2_at
    AND me.occurred_at BETWEEN $2 AND $3
  GROUP BY me.user_key
)
SELECT
  (SELECT COUNT(*) FROM step1) AS step1_users,
  (SELECT COUNT(*) FROM step2) AS step2_users,
  (SELECT COUNT(*) FROM step3) AS step3_users,
  ROUND(
    (SELECT COUNT(*)::NUMERIC FROM step2) /
    NULLIF((SELECT COUNT(*) FROM step1), 0),
    4
  ) AS step1_to_step2_rate,
  ROUND(
    (SELECT COUNT(*)::NUMERIC FROM step3) /
    NULLIF((SELECT COUNT(*) FROM step2), 0),
    4
  ) AS step2_to_step3_rate,
  ROUND(
    (SELECT COUNT(*)::NUMERIC FROM step3) /
    NULLIF((SELECT COUNT(*) FROM step1), 0),
    4
  ) AS full_funnel_rate;


-- --------------------------------------------------------------------------
-- 2. Daily funnel breakdown
--
-- Assign each user to the day of their first step-1 event, then compute how
-- many eventually reached later steps.
-- --------------------------------------------------------------------------
WITH step1 AS (
  SELECT user_key, MIN(occurred_at) AS step1_at
  FROM metric_events
  WHERE env_id = $1
    AND event_name = 'view_pricing'
    AND occurred_at BETWEEN $2 AND $3
  GROUP BY user_key
),
step2 AS (
  SELECT me.user_key, MIN(me.occurred_at) AS step2_at
  FROM metric_events me
  JOIN step1 s1 ON s1.user_key = me.user_key
  WHERE me.env_id = $1
    AND me.event_name = 'start_checkout'
    AND me.occurred_at >= s1.step1_at
  GROUP BY me.user_key
),
step3 AS (
  SELECT me.user_key, MIN(me.occurred_at) AS step3_at
  FROM metric_events me
  JOIN step2 s2 ON s2.user_key = me.user_key
  WHERE me.env_id = $1
    AND me.event_name = 'purchase_completed'
    AND me.occurred_at >= s2.step2_at
  GROUP BY me.user_key
)
SELECT
  DATE_TRUNC('day', s1.step1_at) AS cohort_day,
  COUNT(*) AS step1_users,
  COUNT(s2.user_key) AS step2_users,
  COUNT(s3.user_key) AS step3_users
FROM step1 s1
LEFT JOIN step2 s2 ON s2.user_key = s1.user_key
LEFT JOIN step3 s3 ON s3.user_key = s1.user_key
GROUP BY 1
ORDER BY 1;


-- --------------------------------------------------------------------------
-- 3. N-day retention by signup cohort
--
-- Cohort event: signup_completed
-- Return event: app_opened
--
-- Returns classic retention matrix coordinates:
--   cohort_date, days_since_signup, retained_users
-- --------------------------------------------------------------------------
WITH signup_cohort AS (
  SELECT
    user_key,
    DATE_TRUNC('day', MIN(occurred_at)) AS cohort_date
  FROM metric_events
  WHERE env_id = $1
    AND event_name = 'signup_completed'
    AND occurred_at BETWEEN $2 AND $3
  GROUP BY user_key
),
returns AS (
  SELECT
    sc.cohort_date,
    me.user_key,
    DATE_TRUNC('day', me.occurred_at) AS return_date,
    DATE_PART('day', DATE_TRUNC('day', me.occurred_at) - sc.cohort_date)::INT AS day_number
  FROM signup_cohort sc
  JOIN metric_events me
    ON me.user_key = sc.user_key
   AND me.env_id = $1
   AND me.event_name = 'app_opened'
   AND me.occurred_at >= sc.cohort_date
)
SELECT
  cohort_date,
  day_number,
  COUNT(DISTINCT user_key) AS retained_users
FROM returns
WHERE day_number BETWEEN 0 AND 30
GROUP BY cohort_date, day_number
ORDER BY cohort_date, day_number;


-- --------------------------------------------------------------------------
-- 4. Cohort retention rate matrix
--
-- Adds cohort size and retention rate for each day_number.
-- --------------------------------------------------------------------------
WITH signup_cohort AS (
  SELECT
    user_key,
    DATE_TRUNC('day', MIN(occurred_at)) AS cohort_date
  FROM metric_events
  WHERE env_id = $1
    AND event_name = 'signup_completed'
    AND occurred_at BETWEEN $2 AND $3
  GROUP BY user_key
),
cohort_size AS (
  SELECT cohort_date, COUNT(*) AS users_in_cohort
  FROM signup_cohort
  GROUP BY cohort_date
),
retained AS (
  SELECT
    sc.cohort_date,
    DATE_PART('day', DATE_TRUNC('day', me.occurred_at) - sc.cohort_date)::INT AS day_number,
    COUNT(DISTINCT me.user_key) AS retained_users
  FROM signup_cohort sc
  JOIN metric_events me
    ON me.user_key = sc.user_key
   AND me.env_id = $1
   AND me.event_name = 'app_opened'
   AND me.occurred_at >= sc.cohort_date
  GROUP BY sc.cohort_date, day_number
)
SELECT
  r.cohort_date,
  cs.users_in_cohort,
  r.day_number,
  r.retained_users,
  ROUND(r.retained_users::NUMERIC / NULLIF(cs.users_in_cohort, 0), 4) AS retention_rate
FROM retained r
JOIN cohort_size cs USING (cohort_date)
WHERE r.day_number BETWEEN 0 AND 30
ORDER BY r.cohort_date, r.day_number;


-- --------------------------------------------------------------------------
-- 5. Revenue cohort analysis
--
-- Cohort users by first subscription_started, then compute revenue by month.
-- numeric_value is assumed to be monetary revenue.
-- --------------------------------------------------------------------------
WITH subscription_cohort AS (
  SELECT
    user_key,
    DATE_TRUNC('month', MIN(occurred_at)) AS cohort_month
  FROM metric_events
  WHERE env_id = $1
    AND event_name = 'subscription_started'
    AND occurred_at BETWEEN $2 AND $3
  GROUP BY user_key
),
revenue_events AS (
  SELECT
    sc.cohort_month,
    DATE_TRUNC('month', me.occurred_at) AS revenue_month,
    me.user_key,
    SUM(me.numeric_value) AS revenue
  FROM subscription_cohort sc
  JOIN metric_events me
    ON me.user_key = sc.user_key
   AND me.env_id = $1
   AND me.event_name = 'payment_captured'
   AND me.numeric_value IS NOT NULL
   AND me.occurred_at >= sc.cohort_month
  GROUP BY sc.cohort_month, revenue_month, me.user_key
)
SELECT
  cohort_month,
  revenue_month,
  DATE_PART('month', AGE(revenue_month, cohort_month))::INT AS months_since_cohort,
  COUNT(DISTINCT user_key) AS paying_users,
  SUM(revenue) AS total_revenue,
  AVG(revenue) AS revenue_per_paying_user
FROM revenue_events
GROUP BY cohort_month, revenue_month
ORDER BY cohort_month, revenue_month;


-- --------------------------------------------------------------------------
-- 6. WAU / MAU stickiness
--
-- Active event here is app_opened. Replace with your product's best active-use
-- signal if needed.
-- --------------------------------------------------------------------------
WITH weekly_active AS (
  SELECT
    DATE_TRUNC('week', occurred_at) AS week,
    COUNT(DISTINCT user_key) AS wau
  FROM metric_events
  WHERE env_id = $1
    AND event_name = 'app_opened'
    AND occurred_at BETWEEN $2 AND $3
  GROUP BY 1
),
monthly_active AS (
  SELECT
    DATE_TRUNC('month', occurred_at) AS month,
    COUNT(DISTINCT user_key) AS mau
  FROM metric_events
  WHERE env_id = $1
    AND event_name = 'app_opened'
    AND occurred_at BETWEEN $2 AND $3
  GROUP BY 1
)
SELECT
  w.week,
  w.wau,
  m.mau,
  ROUND(w.wau::NUMERIC / NULLIF(m.mau, 0), 4) AS wau_mau_stickiness
FROM weekly_active w
JOIN monthly_active m
  ON DATE_TRUNC('month', w.week) = m.month
ORDER BY w.week;