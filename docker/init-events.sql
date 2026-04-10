-- ============================================================================
-- Event tables for the release_decision database.
-- Mounted as /docker-entrypoint-initdb.d/02-events.sql so Postgres runs it
-- automatically after creating the DB.
-- ============================================================================

-- --------------------------------------------------------------------------
-- Flag Evaluations (partitioned by evaluated_at)
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

CREATE INDEX IF NOT EXISTS idx_fe_env_flag_time    ON flag_evaluations (env_id, flag_key, evaluated_at);
CREATE INDEX IF NOT EXISTS idx_fe_env_flag_variant ON flag_evaluations (env_id, flag_key, variant, evaluated_at);
CREATE INDEX IF NOT EXISTS idx_fe_env_user         ON flag_evaluations (env_id, user_key, evaluated_at);
CREATE INDEX IF NOT EXISTS idx_fe_experiment       ON flag_evaluations (experiment_id, evaluated_at) WHERE experiment_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_fe_user_props       ON flag_evaluations USING gin (user_props jsonb_path_ops);

-- --------------------------------------------------------------------------
-- Metric Events (partitioned by occurred_at)
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
-- Partitions — current month + default catch-all
-- --------------------------------------------------------------------------
DO $$
DECLARE
  month_start DATE := date_trunc('month', CURRENT_DATE)::date;
  month_end   DATE := (date_trunc('month', CURRENT_DATE) + interval '1 month')::date;
  suffix      TEXT := to_char(CURRENT_DATE, 'YYYY_MM');
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_class WHERE relname = 'flag_evaluations_' || suffix
  ) THEN
    EXECUTE format(
      'CREATE TABLE flag_evaluations_%s PARTITION OF flag_evaluations FOR VALUES FROM (%L) TO (%L)',
      suffix, month_start, month_end
    );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_class WHERE relname = 'metric_events_' || suffix
  ) THEN
    EXECUTE format(
      'CREATE TABLE metric_events_%s PARTITION OF metric_events FOR VALUES FROM (%L) TO (%L)',
      suffix, month_start, month_end
    );
  END IF;

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
