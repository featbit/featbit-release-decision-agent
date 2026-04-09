-- ============================================================================
-- Derived Analytics Layer on top of metric_events
--
-- Goal:
--   Keep metric_events as the single raw event table, then build fast and
--   analysis-friendly derived tables/materialized views for BI workflows.
--
-- Contents:
--   1) fact_sessions         (session grain)
--   2) fact_user_day         (user-day grain)
--   3) dim_user_first_seen   (user cohort seed)
--   4) mv_funnel_daily       (daily funnel summary)
--   5) mv_retention_d30      (cohort retention matrix, day 0..30)
--   6) refresh / load patterns
-- ============================================================================


-- --------------------------------------------------------------------------
-- 1) Session fact table
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS fact_sessions (
  env_id             TEXT         NOT NULL,
  session_id         TEXT         NOT NULL,
  user_key           TEXT,
  session_start_at   TIMESTAMPTZ  NOT NULL,
  session_end_at     TIMESTAMPTZ  NOT NULL,
  session_seconds    INTEGER      NOT NULL,
  event_count        INTEGER      NOT NULL,
  page_view_count    INTEGER      NOT NULL,
  purchase_count     INTEGER      NOT NULL,
  revenue_sum        NUMERIC      NOT NULL,
  first_source       TEXT,
  first_platform     TEXT,
  first_page_url     TEXT,
  updated_at         TIMESTAMPTZ  NOT NULL DEFAULT NOW(),

  PRIMARY KEY (env_id, session_id)
);

CREATE INDEX IF NOT EXISTS idx_fs_env_start ON fact_sessions (env_id, session_start_at);
CREATE INDEX IF NOT EXISTS idx_fs_env_user_start ON fact_sessions (env_id, user_key, session_start_at);


-- Rebuild one time window of sessions (replace $1/$2/$3 with env_id/start/end)
-- DELETE FROM fact_sessions
-- WHERE env_id = $1 AND session_start_at >= $2 AND session_start_at < $3;
--
-- INSERT INTO fact_sessions (
--   env_id, session_id, user_key,
--   session_start_at, session_end_at, session_seconds,
--   event_count, page_view_count, purchase_count, revenue_sum,
--   first_source, first_platform, first_page_url
-- )
-- SELECT
--   me.env_id,
--   me.session_id,
--   MAX(me.user_key) AS user_key,
--   MIN(me.occurred_at) AS session_start_at,
--   MAX(me.occurred_at) AS session_end_at,
--   GREATEST(0, EXTRACT(EPOCH FROM MAX(me.occurred_at) - MIN(me.occurred_at))::INT) AS session_seconds,
--   COUNT(*)::INT AS event_count,
--   COUNT(*) FILTER (WHERE me.event_name = 'page_view')::INT AS page_view_count,
--   COUNT(*) FILTER (WHERE me.event_name = 'purchase_completed')::INT AS purchase_count,
--   COALESCE(SUM(CASE WHEN me.event_name = 'payment_captured' THEN me.numeric_value ELSE 0 END), 0) AS revenue_sum,
--   (ARRAY_AGG(me.source ORDER BY me.occurred_at ASC))[1] AS first_source,
--   (ARRAY_AGG(me.platform ORDER BY me.occurred_at ASC))[1] AS first_platform,
--   (ARRAY_AGG(me.page_url ORDER BY me.occurred_at ASC))[1] AS first_page_url
-- FROM metric_events me
-- WHERE me.env_id = $1
--   AND me.session_id IS NOT NULL
--   AND me.occurred_at >= $2
--   AND me.occurred_at <  $3
-- GROUP BY me.env_id, me.session_id;


-- --------------------------------------------------------------------------
-- 2) User-day fact table
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS fact_user_day (
  env_id               TEXT   NOT NULL,
  event_date           DATE   NOT NULL,
  user_key             TEXT   NOT NULL,

  event_count          INTEGER NOT NULL,
  session_count        INTEGER NOT NULL,
  active_flag          BOOLEAN NOT NULL,

  page_view_count      INTEGER NOT NULL,
  signup_count         INTEGER NOT NULL,
  checkout_count       INTEGER NOT NULL,
  purchase_count       INTEGER NOT NULL,

  revenue_sum          NUMERIC NOT NULL,
  duration_sum_seconds NUMERIC NOT NULL,

  first_source         TEXT,
  first_platform       TEXT,

  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  PRIMARY KEY (env_id, event_date, user_key)
);

CREATE INDEX IF NOT EXISTS idx_fud_env_date ON fact_user_day (env_id, event_date);
CREATE INDEX IF NOT EXISTS idx_fud_env_user_date ON fact_user_day (env_id, user_key, event_date);


-- Rebuild one date window in user-day fact (replace $1/$2/$3 with env_id/start/end)
-- DELETE FROM fact_user_day
-- WHERE env_id = $1 AND event_date >= $2::date AND event_date < $3::date;
--
-- INSERT INTO fact_user_day (
--   env_id, event_date, user_key,
--   event_count, session_count, active_flag,
--   page_view_count, signup_count, checkout_count, purchase_count,
--   revenue_sum, duration_sum_seconds,
--   first_source, first_platform
-- )
-- SELECT
--   me.env_id,
--   DATE_TRUNC('day', me.occurred_at)::date AS event_date,
--   me.user_key,
--
--   COUNT(*)::INT AS event_count,
--   COUNT(DISTINCT me.session_id)::INT AS session_count,
--   TRUE AS active_flag,
--
--   COUNT(*) FILTER (WHERE me.event_name = 'page_view')::INT AS page_view_count,
--   COUNT(*) FILTER (WHERE me.event_name = 'signup_completed')::INT AS signup_count,
--   COUNT(*) FILTER (WHERE me.event_name = 'start_checkout')::INT AS checkout_count,
--   COUNT(*) FILTER (WHERE me.event_name = 'purchase_completed')::INT AS purchase_count,
--
--   COALESCE(SUM(CASE WHEN me.event_name = 'payment_captured' THEN me.numeric_value ELSE 0 END), 0) AS revenue_sum,
--   COALESCE(SUM(CASE WHEN me.event_name = 'session_duration_seconds' THEN me.numeric_value ELSE 0 END), 0) AS duration_sum_seconds,
--
--   (ARRAY_AGG(me.source ORDER BY me.occurred_at ASC))[1] AS first_source,
--   (ARRAY_AGG(me.platform ORDER BY me.occurred_at ASC))[1] AS first_platform
-- FROM metric_events me
-- WHERE me.env_id = $1
--   AND me.occurred_at >= $2
--   AND me.occurred_at <  $3
-- GROUP BY me.env_id, DATE_TRUNC('day', me.occurred_at)::date, me.user_key;


-- --------------------------------------------------------------------------
-- 3) User first-seen dimension (cohort seed)
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS dim_user_first_seen (
  env_id              TEXT         NOT NULL,
  user_key            TEXT         NOT NULL,
  first_seen_at       TIMESTAMPTZ  NOT NULL,
  first_seen_date     DATE         NOT NULL,
  first_seen_month    DATE         NOT NULL,
  first_source        TEXT,
  first_platform      TEXT,

  PRIMARY KEY (env_id, user_key)
);

CREATE INDEX IF NOT EXISTS idx_dufs_env_date ON dim_user_first_seen (env_id, first_seen_date);
CREATE INDEX IF NOT EXISTS idx_dufs_env_month ON dim_user_first_seen (env_id, first_seen_month);


-- Upsert user first-seen from a time window (replace $1/$2/$3 with env_id/start/end)
-- INSERT INTO dim_user_first_seen (
--   env_id, user_key,
--   first_seen_at, first_seen_date, first_seen_month,
--   first_source, first_platform
-- )
-- SELECT
--   x.env_id,
--   x.user_key,
--   x.first_seen_at,
--   x.first_seen_at::date AS first_seen_date,
--   DATE_TRUNC('month', x.first_seen_at)::date AS first_seen_month,
--   x.first_source,
--   x.first_platform
-- FROM (
--   SELECT DISTINCT ON (me.env_id, me.user_key)
--     me.env_id,
--     me.user_key,
--     me.occurred_at AS first_seen_at,
--     me.source AS first_source,
--     me.platform AS first_platform
--   FROM metric_events me
--   WHERE me.env_id = $1
--     AND me.occurred_at >= $2
--     AND me.occurred_at <  $3
--   ORDER BY me.env_id, me.user_key, me.occurred_at ASC
-- ) x
-- ON CONFLICT (env_id, user_key) DO UPDATE
-- SET first_seen_at = LEAST(dim_user_first_seen.first_seen_at, EXCLUDED.first_seen_at),
--     first_seen_date = LEAST(dim_user_first_seen.first_seen_date, EXCLUDED.first_seen_date),
--     first_seen_month = LEAST(dim_user_first_seen.first_seen_month, EXCLUDED.first_seen_month),
--     first_source = COALESCE(dim_user_first_seen.first_source, EXCLUDED.first_source),
--     first_platform = COALESCE(dim_user_first_seen.first_platform, EXCLUDED.first_platform);


-- --------------------------------------------------------------------------
-- 4) Materialized view: daily funnel summary
-- --------------------------------------------------------------------------
DROP MATERIALIZED VIEW IF EXISTS mv_funnel_daily;
CREATE MATERIALIZED VIEW mv_funnel_daily AS
WITH step1 AS (
  SELECT env_id, user_key, MIN(occurred_at) AS step1_at
  FROM metric_events
  WHERE event_name = 'view_pricing'
  GROUP BY env_id, user_key
),
step2 AS (
  SELECT me.env_id, me.user_key, MIN(me.occurred_at) AS step2_at
  FROM metric_events me
  JOIN step1 s1 ON s1.env_id = me.env_id AND s1.user_key = me.user_key
  WHERE me.event_name = 'start_checkout'
    AND me.occurred_at >= s1.step1_at
  GROUP BY me.env_id, me.user_key
),
step3 AS (
  SELECT me.env_id, me.user_key, MIN(me.occurred_at) AS step3_at
  FROM metric_events me
  JOIN step2 s2 ON s2.env_id = me.env_id AND s2.user_key = me.user_key
  WHERE me.event_name = 'purchase_completed'
    AND me.occurred_at >= s2.step2_at
  GROUP BY me.env_id, me.user_key
)
SELECT
  s1.env_id,
  DATE_TRUNC('day', s1.step1_at)::date AS cohort_day,
  COUNT(*)::INT AS step1_users,
  COUNT(s2.user_key)::INT AS step2_users,
  COUNT(s3.user_key)::INT AS step3_users,
  ROUND(COUNT(s2.user_key)::NUMERIC / NULLIF(COUNT(*), 0), 4) AS step1_to_step2_rate,
  ROUND(COUNT(s3.user_key)::NUMERIC / NULLIF(COUNT(s2.user_key), 0), 4) AS step2_to_step3_rate,
  ROUND(COUNT(s3.user_key)::NUMERIC / NULLIF(COUNT(*), 0), 4) AS full_funnel_rate
FROM step1 s1
LEFT JOIN step2 s2 ON s2.env_id = s1.env_id AND s2.user_key = s1.user_key
LEFT JOIN step3 s3 ON s3.env_id = s1.env_id AND s3.user_key = s1.user_key
GROUP BY s1.env_id, DATE_TRUNC('day', s1.step1_at)::date;

CREATE INDEX idx_mv_funnel_daily_env_day ON mv_funnel_daily (env_id, cohort_day);


-- --------------------------------------------------------------------------
-- 5) Materialized view: D30 retention matrix (signup -> app_opened)
-- --------------------------------------------------------------------------
DROP MATERIALIZED VIEW IF EXISTS mv_retention_d30;
CREATE MATERIALIZED VIEW mv_retention_d30 AS
WITH signup_cohort AS (
  SELECT
    env_id,
    user_key,
    DATE_TRUNC('day', MIN(occurred_at))::date AS cohort_date
  FROM metric_events
  WHERE event_name = 'signup_completed'
  GROUP BY env_id, user_key
),
cohort_size AS (
  SELECT env_id, cohort_date, COUNT(*)::INT AS users_in_cohort
  FROM signup_cohort
  GROUP BY env_id, cohort_date
),
retained AS (
  SELECT
    sc.env_id,
    sc.cohort_date,
    (DATE_TRUNC('day', me.occurred_at)::date - sc.cohort_date) AS day_number,
    COUNT(DISTINCT me.user_key)::INT AS retained_users
  FROM signup_cohort sc
  JOIN metric_events me
    ON me.env_id = sc.env_id
   AND me.user_key = sc.user_key
   AND me.event_name = 'app_opened'
   AND me.occurred_at >= sc.cohort_date
  GROUP BY sc.env_id, sc.cohort_date, day_number
)
SELECT
  r.env_id,
  r.cohort_date,
  r.day_number,
  cs.users_in_cohort,
  r.retained_users,
  ROUND(r.retained_users::NUMERIC / NULLIF(cs.users_in_cohort, 0), 4) AS retention_rate
FROM retained r
JOIN cohort_size cs
  ON cs.env_id = r.env_id
 AND cs.cohort_date = r.cohort_date
WHERE r.day_number BETWEEN 0 AND 30;

CREATE INDEX idx_mv_retention_d30_env_cohort_day
  ON mv_retention_d30 (env_id, cohort_date, day_number);


-- --------------------------------------------------------------------------
-- 6) Refresh / load operation examples
-- --------------------------------------------------------------------------
-- Full refresh (offline window)
-- REFRESH MATERIALIZED VIEW mv_funnel_daily;
-- REFRESH MATERIALIZED VIEW mv_retention_d30;
--
-- If you need low-lock refresh in production, use:
--   1) add unique indexes required by Postgres
--   2) REFRESH MATERIALIZED VIEW CONCURRENTLY ...
--
-- Suggested cadence:
--   - fact_user_day / fact_sessions: every 5-15 minutes (incremental)
--   - dim_user_first_seen: hourly incremental upsert
--   - mv_funnel_daily / mv_retention_d30: every 15-60 minutes
