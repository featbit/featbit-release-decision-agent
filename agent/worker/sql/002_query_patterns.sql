-- ============================================================================
-- Standard Query Patterns for Experiment Analysis
-- ============================================================================
-- Runtime implementation: src/adapters/featbit.ts
-- This file is the canonical SQL reference — runnable in psql for debugging.
--
-- Parameters ($1–$6):
--   $1  env_id           text          e.g. 'env-abc123'
--   $2  flag_key         text          e.g. 'show-new-pricing'
--   $3  experiment_id    text          e.g. 'exp-001'
--   $4  start            timestamptz   e.g. '2025-07-01'
--   $5  end              timestamptz   e.g. '2025-07-31'
--   $6  event_name       text          e.g. 'purchase_completed'
--
-- To run with psql, use PREPARE + EXECUTE:
--   PREPARE q_binary(text,text,text,timestamptz,timestamptz,text) AS <query>;
--   EXECUTE q_binary('env-1','flag-1','exp-1','2025-07-01','2025-07-31','purchase');
--
-- Index coverage (see 001_event_tables.sql):
--   first_exposure  → idx_fe_experiment (experiment_id, evaluated_at)
--                   + idx_fe_env_flag_time (env_id, flag_key, evaluated_at)
--   metric JOIN     → idx_me_env_event_time (env_id, event_name, occurred_at)
--
-- Partition pruning:
--   evaluated_at BETWEEN $4 AND $5  → scans only matching monthly partitions
--   occurred_at  BETWEEN $4 AND $5  → same for metric_events
--   Always include the BETWEEN clause; removing it disables pruning.
-- ============================================================================


-- ══════════════════════════════════════════════════════════════════════════════
-- 1. BINARY METRIC — conversion rate (did the user trigger the event?)
--    Output: variant | n (exposed) | k (converted)
-- ══════════════════════════════════════════════════════════════════════════════

WITH first_exposure AS (
  -- Deduplicate to one row per user: their first flag evaluation.
  -- DISTINCT ON (user_key) + ORDER BY evaluated_at ASC = first exposure.
  SELECT DISTINCT ON (user_key)
    user_key, variant, evaluated_at AS first_exposed_at
  FROM flag_evaluations
  WHERE env_id        = $1
    AND flag_key      = $2
    AND experiment_id = $3
    AND evaluated_at BETWEEN $4 AND $5
  ORDER BY user_key, evaluated_at ASC
),
exposed AS (
  SELECT variant, COUNT(*) AS n
  FROM first_exposure
  GROUP BY variant
),
converted AS (
  -- A user converts if they triggered the metric event AFTER their first exposure.
  -- COUNT(DISTINCT user_key) avoids double-counting repeat conversions.
  SELECT fe.variant, COUNT(DISTINCT fe.user_key) AS k
  FROM first_exposure fe
  JOIN metric_events me
    ON  me.user_key     = fe.user_key
    AND me.env_id       = $1
    AND me.event_name   = $6
    AND me.occurred_at >= fe.first_exposed_at          -- causal ordering
    AND me.occurred_at BETWEEN $4 AND $5               -- partition pruning
  GROUP BY fe.variant
)
SELECT
  e.variant,
  e.n,
  COALESCE(c.k, 0) AS k          -- 0 conversions when no user converted
FROM exposed e
LEFT JOIN converted c USING (variant);


-- ══════════════════════════════════════════════════════════════════════════════
-- 2. CONTINUOUS METRIC — per-user aggregated value
--    Output: variant | n | mean | variance | total
--
--    Two-stage aggregation:
--      Stage 1 (per_user): aggregate each user's events into one number
--      Stage 2 (outer):    compute mean/variance/total across users
--
--    The Stage-1 aggregation depends on Experiment.primaryMetricAgg:
--    ┌──────────┬───────────────────────────────────────────────────────┐
--    │ metricAgg│ SQL expression (per-user)                            │
--    ├──────────┼───────────────────────────────────────────────────────┤
--    │ sum      │ SUM(me.numeric_value)                                │
--    │ mean     │ AVG(me.numeric_value)                                │
--    │ count    │ COUNT(me.numeric_value)                              │
--    │ latest   │ (ARRAY_AGG(me.numeric_value ORDER BY occurred_at DESC))[1] │
--    │ once     │ (ARRAY_AGG(me.numeric_value ORDER BY occurred_at ASC))[1]  │
--    └──────────┴───────────────────────────────────────────────────────┘
--    featbit.ts switches via aggFunction(metricAgg) at runtime.
--    Below uses SUM; swap the marked line for other aggregation types.
-- ══════════════════════════════════════════════════════════════════════════════

WITH first_exposure AS (
  SELECT DISTINCT ON (user_key)
    user_key, variant, evaluated_at AS first_exposed_at
  FROM flag_evaluations
  WHERE env_id        = $1
    AND flag_key      = $2
    AND experiment_id = $3
    AND evaluated_at BETWEEN $4 AND $5
  ORDER BY user_key, evaluated_at ASC
),
per_user AS (
  SELECT
    fe.variant,
    fe.user_key,
    -- ┌─── Stage-1 aggregation (choose one) ──────────────────────────┐
       SUM(me.numeric_value)                                AS user_value  -- sum
    -- AVG(me.numeric_value)                                AS user_value  -- mean
    -- COUNT(me.numeric_value)                              AS user_value  -- count
    -- (ARRAY_AGG(me.numeric_value ORDER BY me.occurred_at DESC))[1] AS user_value  -- latest
    -- (ARRAY_AGG(me.numeric_value ORDER BY me.occurred_at ASC))[1]  AS user_value  -- once
    -- └───────────────────────────────────────────────────────────────┘
  FROM first_exposure fe
  JOIN metric_events me
    ON  me.user_key     = fe.user_key
    AND me.env_id       = $1
    AND me.event_name   = $6
    AND me.occurred_at >= fe.first_exposed_at              -- causal ordering
    AND me.occurred_at BETWEEN $4 AND $5                   -- partition pruning
  WHERE me.numeric_value IS NOT NULL
  GROUP BY fe.variant, fe.user_key
)
SELECT
  variant,
  COUNT(*)             AS n,
  AVG(user_value)      AS mean,
  VAR_SAMP(user_value) AS variance,
  SUM(user_value)      AS total
FROM per_user
GROUP BY variant;


-- ══════════════════════════════════════════════════════════════════════════════
-- 3. DIAGNOSTIC: Exposure sanity check
--    Verify flag evaluations exist and traffic is balanced before analysis.
-- ══════════════════════════════════════════════════════════════════════════════

SELECT
  variant,
  COUNT(*)                  AS total_evals,
  COUNT(DISTINCT user_key)  AS unique_users,
  MIN(evaluated_at)         AS first_eval,
  MAX(evaluated_at)         AS last_eval
FROM flag_evaluations
WHERE env_id        = $1
  AND flag_key      = $2
  AND experiment_id = $3
  AND evaluated_at BETWEEN $4 AND $5
GROUP BY variant
ORDER BY variant;


-- ══════════════════════════════════════════════════════════════════════════════
-- 4. DIAGNOSTIC: Metric event volume
--    Confirm metric events are flowing for the target event name.
-- ══════════════════════════════════════════════════════════════════════════════

SELECT
  COUNT(*)                                    AS total_events,
  COUNT(DISTINCT user_key)                    AS unique_users,
  COUNT(numeric_value)                        AS with_value,
  COUNT(*) - COUNT(numeric_value)             AS null_value,
  MIN(occurred_at)                            AS first_event,
  MAX(occurred_at)                            AS last_event
FROM metric_events
WHERE env_id     = $1
  AND event_name = $6
  AND occurred_at BETWEEN $4 AND $5;


-- ══════════════════════════════════════════════════════════════════════════════
-- 5. DIAGNOSTIC: Sample Ratio Mismatch (SRM) check
--    Compare actual traffic split per variant. A skew > 1-2 pp from the
--    expected ratio (e.g. 50/50) signals a randomization bug.
-- ══════════════════════════════════════════════════════════════════════════════

WITH first_exposure AS (
  SELECT DISTINCT ON (user_key) user_key, variant
  FROM flag_evaluations
  WHERE env_id        = $1
    AND flag_key      = $2
    AND experiment_id = $3
    AND evaluated_at BETWEEN $4 AND $5
  ORDER BY user_key, evaluated_at ASC
)
SELECT
  variant,
  COUNT(*)                                                       AS n,
  ROUND(COUNT(*)::numeric / SUM(COUNT(*)) OVER () * 100, 2)     AS pct
FROM first_exposure
GROUP BY variant
ORDER BY variant;
