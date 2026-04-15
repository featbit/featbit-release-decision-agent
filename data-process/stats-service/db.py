"""
PostgreSQL client for stats-service.

Reads:  experiment_run JOIN experiment WHERE status = 'running'
Writes: analysis_result back to experiment_run
"""

import os
import psycopg2
import psycopg2.extras

DATABASE_URL = os.environ.get("DATABASE_URL", "")

_SELECT = """
    SELECT er.id,
           er.slug,
           er.status,
           er.method,
           er.primary_metric_event,
           er.guardrail_events,
           er.control_variant,
           er.treatment_variant,
           er.observation_start,
           er.observation_end,
           er.prior_proper,
           er.prior_mean,
           er.prior_stddev,
           er.minimum_sample,
           er.primary_metric_agg,
           er.primary_metric_type,
           er.analysis_result,
           e.featbit_env_id  AS env_id,
           e.flag_key
    FROM   experiment_run er
    JOIN   experiment e ON e.id = er.experiment_id
"""


def _connect():
    return psycopg2.connect(DATABASE_URL)


def get_running_experiments() -> list[dict]:
    """Return all ExperimentRuns with status='running' that have enough info to analyze."""
    sql = _SELECT + """
        WHERE  er.status = 'running'
          AND  e.featbit_env_id        IS NOT NULL
          AND  e.flag_key              IS NOT NULL
          AND  er.primary_metric_event IS NOT NULL
    """
    with _connect() as conn:
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute(sql)
            return [dict(r) for r in cur.fetchall()]


def get_run_by_id(run_id: str) -> dict | None:
    """Fetch a single ExperimentRun by id (any status)."""
    sql = _SELECT + "WHERE er.id = %s"
    with _connect() as conn:
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute(sql, (run_id,))
            row = cur.fetchone()
            return dict(row) if row else None


def save_analysis_result(run_id: str, result_json: str) -> None:
    """Write analysis_result to experiment_run."""
    sql = "UPDATE experiment_run SET analysis_result = %s, updated_at = NOW() WHERE id = %s"
    with _connect() as conn:
        with conn.cursor() as cur:
            cur.execute(sql, (result_json, run_id))
        conn.commit()
