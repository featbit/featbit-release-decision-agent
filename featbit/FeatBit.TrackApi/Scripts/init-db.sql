-- ============================================================================
-- FeatBit Track API  —  Database bootstrap
--
-- Usage:
--   docker exec release-decision-pg psql -U postgres -f /dev/stdin < Scripts/init-db.sql
--   OR  psql -U postgres -f Scripts/init-db.sql
--
-- Idempotent: uses IF NOT EXISTS / CREATE OR REPLACE where possible.
-- ============================================================================

-- 1. Create database (must be run outside a transaction)
SELECT 'CREATE DATABASE featbit_events'
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'featbit_events')\gexec

\connect featbit_events

-- --------------------------------------------------------------------------
-- 2. Flag Evaluations
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS flag_evaluations (
  id              BIGSERIAL    NOT NULL,
  env_id          TEXT         NOT NULL,
  flag_key        TEXT         NOT NULL,
  user_key        TEXT         NOT NULL,
  variant         TEXT         NOT NULL,
  experiment_id   TEXT,
  layer_id        TEXT,
  evaluated_at    TIMESTAMPTZ  NOT NULL,
  received_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  session_id      TEXT,
  user_props      JSONB        NOT NULL DEFAULT '{}'
  , PRIMARY KEY (id, evaluated_at)
) PARTITION BY RANGE (evaluated_at);

-- Indexes (IF NOT EXISTS requires PG 9.5+)
CREATE INDEX IF NOT EXISTS idx_fe_env_flag_time    ON flag_evaluations (env_id, flag_key, evaluated_at);
CREATE INDEX IF NOT EXISTS idx_fe_env_flag_variant ON flag_evaluations (env_id, flag_key, variant, evaluated_at);
CREATE INDEX IF NOT EXISTS idx_fe_env_user         ON flag_evaluations (env_id, user_key, evaluated_at);
CREATE INDEX IF NOT EXISTS idx_fe_experiment       ON flag_evaluations (experiment_id, evaluated_at) WHERE experiment_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_fe_user_props       ON flag_evaluations USING gin (user_props jsonb_path_ops);

-- --------------------------------------------------------------------------
-- 3. Metric Events
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS metric_events (
  id              BIGSERIAL    NOT NULL,
  env_id          TEXT         NOT NULL,
  event_name      TEXT         NOT NULL,
  event_id        TEXT,
  insert_id       TEXT,
  user_key        TEXT         NOT NULL,
  anonymous_id    TEXT,
  account_id      TEXT,
  numeric_value   NUMERIC,
  occurred_at     TIMESTAMPTZ  NOT NULL,
  received_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  session_id      TEXT,
  source          TEXT,
  platform        TEXT,
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
  unit            TEXT,
  currency        TEXT,
  props           JSONB        NOT NULL DEFAULT '{}'
  , PRIMARY KEY (id, occurred_at)
) PARTITION BY RANGE (occurred_at);

CREATE INDEX IF NOT EXISTS idx_me_env_event_time ON metric_events (env_id, event_name, occurred_at);
CREATE INDEX IF NOT EXISTS idx_me_env_user       ON metric_events (env_id, user_key, occurred_at);
CREATE INDEX IF NOT EXISTS idx_me_env_account    ON metric_events (env_id, account_id, occurred_at) WHERE account_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_me_env_anon       ON metric_events (env_id, anonymous_id, occurred_at) WHERE anonymous_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_me_env_time       ON metric_events (env_id, occurred_at);
CREATE INDEX IF NOT EXISTS idx_me_event_time     ON metric_events (event_name, occurred_at);
CREATE INDEX IF NOT EXISTS idx_me_session_time   ON metric_events (session_id, occurred_at) WHERE session_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_me_insert_id      ON metric_events (env_id, insert_id, occurred_at) WHERE insert_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_me_props          ON metric_events USING gin (props jsonb_path_ops);

-- --------------------------------------------------------------------------
-- 4. Partitions  —  current month + default catch-all
-- --------------------------------------------------------------------------
DO $$
DECLARE
  month_start DATE := date_trunc('month', CURRENT_DATE)::date;
  month_end   DATE := (date_trunc('month', CURRENT_DATE) + interval '1 month')::date;
  suffix      TEXT := to_char(CURRENT_DATE, 'YYYY_MM');
BEGIN
  -- Flag evaluations – monthly partition
  IF NOT EXISTS (
    SELECT 1 FROM pg_class WHERE relname = 'flag_evaluations_' || suffix
  ) THEN
    EXECUTE format(
      'CREATE TABLE flag_evaluations_%s PARTITION OF flag_evaluations FOR VALUES FROM (%L) TO (%L)',
      suffix, month_start, month_end
    );
  END IF;

  -- Metric events – monthly partition
  IF NOT EXISTS (
    SELECT 1 FROM pg_class WHERE relname = 'metric_events_' || suffix
  ) THEN
    EXECUTE format(
      'CREATE TABLE metric_events_%s PARTITION OF metric_events FOR VALUES FROM (%L) TO (%L)',
      suffix, month_start, month_end
    );
  END IF;

  -- Default catch-all partitions
  IF NOT EXISTS (
    SELECT 1 FROM pg_class WHERE relname = 'flag_evaluations_default'
  ) THEN
    CREATE TABLE flag_evaluations_default PARTITION OF flag_evaluations DEFAULT;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_class WHERE relname = 'metric_events_default'
  ) THEN
    CREATE TABLE metric_events_default PARTITION OF metric_events DEFAULT;
  END IF;
END $$;

-- --------------------------------------------------------------------------
-- Done
-- --------------------------------------------------------------------------
\echo '✓ featbit_events database initialized'
