-- ============================================================================
-- FeatBit Event Tables  —  PostgreSQL
--
-- These tables live in the release_decision database alongside Prisma tables.
-- The Track API and worker both connect to this same DB.
-- ============================================================================

-- --------------------------------------------------------------------------
-- 1. Flag Evaluations  —  every SDK variation() call writes one row
-- --------------------------------------------------------------------------
CREATE TABLE flag_evaluations (
  id              BIGSERIAL    NOT NULL,

  -- Scope: which environment + flag
  env_id          TEXT         NOT NULL,
  flag_key        TEXT         NOT NULL,

  -- Who saw what
  user_key        TEXT         NOT NULL,
  variant         TEXT         NOT NULL,

  -- Experiment staining  —  set by SDK when evaluation is part of an experiment
  experiment_id   TEXT,          -- null for non-experiment evaluations
  layer_id        TEXT,          -- null if not using layered experiments

  -- Timestamps
  evaluated_at    TIMESTAMPTZ  NOT NULL,                 -- SDK-side timestamp
  received_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW(),   -- server-side receive time

  -- Context
  session_id      TEXT,
  user_props      JSONB        NOT NULL DEFAULT '{}'     -- user attribute snapshot at eval time
  , PRIMARY KEY (id, evaluated_at)                        -- partition key must be in PK
) PARTITION BY RANGE (evaluated_at);

-- Primary query patterns
CREATE INDEX idx_fe_env_flag_time    ON flag_evaluations (env_id, flag_key, evaluated_at);
CREATE INDEX idx_fe_env_flag_variant ON flag_evaluations (env_id, flag_key, variant, evaluated_at);
CREATE INDEX idx_fe_env_user         ON flag_evaluations (env_id, user_key, evaluated_at);
CREATE INDEX idx_fe_experiment       ON flag_evaluations (experiment_id, evaluated_at) WHERE experiment_id IS NOT NULL;
CREATE INDEX idx_fe_user_props       ON flag_evaluations USING gin (user_props jsonb_path_ops);


-- --------------------------------------------------------------------------
-- 2. Metric Events  —  every SDK track() call writes one row
--
-- This remains the canonical raw event table for both:
--   1. experiment analysis (binary + continuous metrics)
--   2. downstream product analytics / BI workloads
--
-- The current worker only relies on env_id, event_name, user_key,
-- numeric_value, occurred_at, and props. The extra columns below are added
-- to make the table usable as a general event stream without introducing a
-- second raw-events table.
-- --------------------------------------------------------------------------
CREATE TABLE metric_events (
  id              BIGSERIAL    NOT NULL,

  -- Scope
  env_id          TEXT         NOT NULL,
  event_name      TEXT         NOT NULL,
  event_id        TEXT,             -- logical event id from producer, if available
  insert_id       TEXT,             -- client-generated dedupe id; may be retried

  -- Who did what
  user_key        TEXT         NOT NULL,
  anonymous_id    TEXT,
  account_id      TEXT,
  numeric_value   NUMERIC,          -- NULL = binary (did/didn't); non-NULL = continuous (revenue, duration, count)

  -- Timestamps
  occurred_at     TIMESTAMPTZ  NOT NULL,
  received_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW(),

  -- Context
  session_id      TEXT,
  source          TEXT,             -- web | server | mobile | batch | sdk
  platform        TEXT,             -- browser | ios | android | backend
  page_url        TEXT,
  screen_name     TEXT,
  referrer        TEXT,
  app_version     TEXT,
  country         TEXT,
  region          TEXT,
  city            TEXT,
  device_type     TEXT,
  os_name         TEXT,
  browser_name    TEXT,
  unit            TEXT,             -- ms | sec | usd | count | pct
  currency        TEXT,             -- ISO 4217 when numeric_value is monetary
  props           JSONB        NOT NULL DEFAULT '{}'
  , PRIMARY KEY (id, occurred_at)                         -- partition key must be in PK
) PARTITION BY RANGE (occurred_at);

CREATE INDEX idx_me_env_event_time ON metric_events (env_id, event_name, occurred_at);
CREATE INDEX idx_me_env_user       ON metric_events (env_id, user_key, occurred_at);
CREATE INDEX idx_me_env_account    ON metric_events (env_id, account_id, occurred_at) WHERE account_id IS NOT NULL;
CREATE INDEX idx_me_env_anon       ON metric_events (env_id, anonymous_id, occurred_at) WHERE anonymous_id IS NOT NULL;
CREATE INDEX idx_me_env_time       ON metric_events (env_id, occurred_at);
CREATE INDEX idx_me_event_time     ON metric_events (event_name, occurred_at);
CREATE INDEX idx_me_session_time   ON metric_events (session_id, occurred_at) WHERE session_id IS NOT NULL;
CREATE INDEX idx_me_insert_id      ON metric_events (env_id, insert_id, occurred_at) WHERE insert_id IS NOT NULL;
CREATE INDEX idx_me_props          ON metric_events USING gin (props jsonb_path_ops);


-- --------------------------------------------------------------------------
-- 3. Monthly partitions  —  create ahead of time or via pg_partman
-- --------------------------------------------------------------------------
-- Current month
CREATE TABLE flag_evaluations_2026_04
  PARTITION OF flag_evaluations
  FOR VALUES FROM ('2026-04-01') TO ('2026-05-01');

CREATE TABLE metric_events_2026_04
  PARTITION OF metric_events
  FOR VALUES FROM ('2026-04-01') TO ('2026-05-01');

-- Default catch-all for any row outside named partitions
CREATE TABLE flag_evaluations_default  PARTITION OF flag_evaluations DEFAULT;
CREATE TABLE metric_events_default     PARTITION OF metric_events DEFAULT;


-- ============================================================================
-- Staining / Layered Experiments — How it works
-- ============================================================================
--
-- MUTUAL EXCLUSIVITY (within a layer):
--   Users are hashed: bucket = hash(user_key + layer_salt) % 100
--   Experiment A claims buckets 0-49, B claims 50-99.
--   SDK checks bucket → sets experiment_id on the flag_evaluation row.
--   Users outside any experiment's bucket range → experiment_id = NULL.
--
-- ORTHOGONAL (across layers):
--   Each layer uses a different salt → independent bucket assignment.
--   Same user can be in experiment A (layer "checkout") AND
--   experiment C (layer "search") simultaneously.
--   Each flag_evaluation row has its own experiment_id → clean isolation.
--
-- QUERY ISOLATION:
--   WHERE experiment_id = 'my-experiment' filters to exactly the right population.
--   No need to parse user_props or do complex segment logic at query time.
-- ============================================================================
