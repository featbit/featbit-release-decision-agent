-- ============================================================================
-- Standard Query Patterns for Experiment Analysis
-- ============================================================================

-- --------------------------------------------------------------------------
-- BINARY METRIC: conversion rate (did the user trigger the event? yes/no)
-- Returns: variant, n (exposed), k (converted)
-- --------------------------------------------------------------------------
WITH first_exposure AS (
  SELECT DISTINCT ON (user_key)
    user_key, variant, evaluated_at AS first_exposed_at
  FROM flag_evaluations
  WHERE env_id = $1
    AND flag_key = $2
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
  SELECT fe.variant, COUNT(DISTINCT fe.user_key) AS k
  FROM first_exposure fe
  JOIN metric_events me
    ON  me.user_key      = fe.user_key
    AND me.env_id        = $1
    AND me.event_name    = $6
    AND me.occurred_at  >= fe.first_exposed_at
    AND me.occurred_at  BETWEEN $4 AND $5
  GROUP BY fe.variant
)
SELECT e.variant, e.n, COALESCE(c.k, 0) AS k
FROM exposed e
LEFT JOIN converted c USING (variant);


-- --------------------------------------------------------------------------
-- CONTINUOUS METRIC: per-user aggregated value (revenue, duration, count)
-- Returns: variant, n, mean, variance, total
--
-- The inner aggregation (SUM/AVG/MAX/COUNT) depends on the metric's
-- aggregation type stored in Experiment.primaryMetricAggregation:
--   sum    → SUM(numeric_value)   — total revenue per user
--   mean   → AVG(numeric_value)   — average session duration per user
--   count  → COUNT(numeric_value) — number of events per user
--   latest → last numeric_value   — most recent value
-- --------------------------------------------------------------------------
WITH first_exposure AS (
  SELECT DISTINCT ON (user_key)
    user_key, variant, evaluated_at AS first_exposed_at
  FROM flag_evaluations
  WHERE env_id = $1
    AND flag_key = $2
    AND experiment_id = $3
    AND evaluated_at BETWEEN $4 AND $5
  ORDER BY user_key, evaluated_at ASC
),
per_user AS (
  SELECT
    fe.variant,
    fe.user_key,
    -- ← Replace SUM with the appropriate aggregation function
    SUM(me.numeric_value) AS user_value
  FROM first_exposure fe
  JOIN metric_events me
    ON  me.user_key      = fe.user_key
    AND me.env_id        = $1
    AND me.event_name    = $6
    AND me.occurred_at  >= fe.first_exposed_at
    AND me.occurred_at  BETWEEN $4 AND $5
  WHERE me.numeric_value IS NOT NULL
  GROUP BY fe.variant, fe.user_key
)
SELECT
  variant,
  COUNT(*)                  AS n,
  AVG(user_value)           AS mean,
  VAR_SAMP(user_value)      AS variance,
  SUM(user_value)           AS total
FROM per_user
GROUP BY variant;
