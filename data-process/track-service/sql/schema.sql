--------------------------------------------------------------------------------
-- track-service ClickHouse schema
--------------------------------------------------------------------------------
-- Run these in clickhouse-client (or the Play UI) once, against the cluster
-- track-service is configured to talk to. Idempotent — uses `IF NOT EXISTS`.
--
-- After this you can point track-service at the cluster and it will start
-- INSERTing into these tables.
--------------------------------------------------------------------------------

-- 1. Database
CREATE DATABASE IF NOT EXISTS featbit;


-- 2. Flag evaluations — one row per "user X saw flag Y as variant Z at time T"
--
-- Partitioning by month keeps individual parts manageable as the experiment
-- runs for weeks. ORDER BY puts the columns we filter on first
-- (env_id, flag_key, date) so range scans for a given experiment are cheap.
CREATE TABLE IF NOT EXISTS featbit.flag_evaluations
(
    env_id          LowCardinality(String),
    flag_key        LowCardinality(String),
    user_key        String,
    variant         LowCardinality(String),
    experiment_id   Nullable(String),
    layer_id        Nullable(String),
    hash_bucket     UInt8,
    timestamp       DateTime64(3, 'UTC'),
    -- Reserved for future subgroup analysis; raw user.properties JSON.
    -- Empty by default; SDKs that want slicing can populate it.
    user_properties String DEFAULT '{}' CODEC(ZSTD(3))
)
ENGINE = MergeTree
PARTITION BY toYYYYMM(timestamp)
ORDER BY (env_id, flag_key, toDate(timestamp), user_key)
TTL toDate(timestamp) + INTERVAL 365 DAY    -- adjust to your retention policy
SETTINGS index_granularity = 8192;


-- 3. Metric events — one row per "user X fired event Y at time T"
CREATE TABLE IF NOT EXISTS featbit.metric_events
(
    env_id          LowCardinality(String),
    event_name      LowCardinality(String),
    user_key        String,
    numeric_value   Nullable(Float64),
    timestamp       DateTime64(3, 'UTC'),
    user_properties String DEFAULT '{}' CODEC(ZSTD(3))
)
ENGINE = MergeTree
PARTITION BY toYYYYMM(timestamp)
ORDER BY (env_id, event_name, toDate(timestamp), user_key)
TTL toDate(timestamp) + INTERVAL 365 DAY
SETTINGS index_granularity = 8192;


--------------------------------------------------------------------------------
-- Optional: materialized views
--------------------------------------------------------------------------------
-- The /api/query/experiment endpoint queries the raw tables directly today
-- (ClickHouse is fast enough for hundreds of millions of rows in this shape).
-- If query latency becomes a problem, uncomment and create one of these.
--------------------------------------------------------------------------------

-- Per-day, per-variant unique-user counter for flag evaluations
-- (use uniqExact for exact counts, or uniqHLL12 for ~1% error and 100x less RAM)
--
-- CREATE MATERIALIZED VIEW IF NOT EXISTS featbit.flag_eval_daily
-- ENGINE = AggregatingMergeTree
-- PARTITION BY toYYYYMM(date)
-- ORDER BY (env_id, flag_key, date, variant)
-- AS
-- SELECT
--     env_id,
--     flag_key,
--     toDate(timestamp) AS date,
--     variant,
--     uniqExactState(user_key)        AS users_state
-- FROM featbit.flag_evaluations
-- GROUP BY env_id, flag_key, date, variant;


-- Per-day, per-event metric aggregates
--
-- CREATE MATERIALIZED VIEW IF NOT EXISTS featbit.metric_event_daily
-- ENGINE = AggregatingMergeTree
-- PARTITION BY toYYYYMM(date)
-- ORDER BY (env_id, event_name, date)
-- AS
-- SELECT
--     env_id,
--     event_name,
--     toDate(timestamp) AS date,
--     uniqExactState(user_key)              AS users_state,
--     countState()                          AS events_state,
--     sumState(numeric_value)               AS sum_state,
--     sumState(numeric_value * numeric_value) AS sum_sq_state
-- FROM featbit.metric_events
-- GROUP BY env_id, event_name, date;
