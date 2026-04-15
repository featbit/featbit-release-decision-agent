"""
R2 client for stats-service.

Reads flag-eval and metric-event rollup files and aggregates per-variant
experiment statistics for use by the Bayesian / Bandit analysis modules.
"""

import json
import logging
import os
import re
from datetime import date, timedelta

import boto3
from botocore.config import Config
from botocore.exceptions import ClientError

log = logging.getLogger(__name__)

R2_ACCOUNT_ID = os.environ.get("R2_ACCOUNT_ID",        "")
R2_ACCESS_KEY = os.environ.get("R2_ACCESS_KEY_ID",     "")
R2_SECRET_KEY = os.environ.get("R2_SECRET_ACCESS_KEY", "")
BUCKET        = os.environ.get("R2_BUCKET_NAME",       "featbit-tsdb")

_SANITIZE_RE = re.compile(r"[^\w-]")


def _client():
    return boto3.client(
        "s3",
        region_name="auto",
        endpoint_url=f"https://{R2_ACCOUNT_ID}.r2.cloudflarestorage.com",
        aws_access_key_id=R2_ACCESS_KEY,
        aws_secret_access_key=R2_SECRET_KEY,
        config=Config(signature_version="s3v4"),
    )


def sanitize(s: str) -> str:
    """Mirror of cf-worker sanitize(): replace non-word/non-hyphen chars with '_'."""
    return _SANITIZE_RE.sub("_", s)


def _date_range(start: date, end: date) -> list[str]:
    dates, d = [], start
    while d <= end:
        dates.append(d.strftime("%Y-%m-%d"))
        d += timedelta(days=1)
    return dates


def _get_json(s3_client, key: str) -> dict | None:
    try:
        resp = s3_client.get_object(Bucket=BUCKET, Key=key)
        return json.loads(resp["Body"].read())
    except ClientError as e:
        if e.response["Error"]["Code"] in ("NoSuchKey", "404"):
            return None
        log.warning("R2 GET %s failed: %s", key, e)
        return None
    except Exception as e:
        log.warning("R2 GET %s error: %s", key, e)
        return None


def _merge_fe(existing: list, incoming: list) -> list:
    """Keep flag-eval entry with the earlier timestamp (index 0)."""
    return incoming if incoming[0] < existing[0] else existing


def _merge_me(existing: list, incoming: list) -> list:
    """Accumulate metric-event entry."""
    e = list(existing)
    e[0] = 1 if (e[0] == 1 or incoming[0] == 1) else 0
    if incoming[1] < e[1]: e[1], e[2] = incoming[1], incoming[2]
    if incoming[3] > e[3]: e[3], e[4] = incoming[3], incoming[4]
    e[5] += incoming[5]
    e[6] += incoming[6]
    return e


def aggregate_experiment(
    env_id: str,
    flag_key: str,
    metric_event: str,
    observation_start: date,
    observation_end: date | None = None,
) -> dict:
    """
    Read all rollup files in the observation window and aggregate per-variant stats.

    Returns a metrics_data dict in the format expected by bayesian.py / bandit.py:
        {
          "<metric_event>": {
            "<variant>": { "n": int, "k": int }   # binary / proportion
          }
        }

    Returns {} if no rollup data is found.
    """
    s3    = _client()
    env   = sanitize(env_id)
    flag  = sanitize(flag_key)
    event = sanitize(metric_event)
    end   = observation_end or date.today()
    dates = _date_range(observation_start, end)

    if not dates:
        return {}

    # Merge all flag-eval and metric-event rollups per user across all dates
    fe_users: dict[str, list] = {}
    me_users: dict[str, list] = {}

    for d in dates:
        fe_obj = _get_json(s3, f"rollups/flag-evals/{env}/{flag}/{d}.json")
        if fe_obj:
            for uk, entry in fe_obj.get("u", {}).items():
                fe_users[uk] = _merge_fe(fe_users[uk], entry) if uk in fe_users else list(entry)

        me_obj = _get_json(s3, f"rollups/metric-events/{env}/{event}/{d}.json")
        if me_obj:
            for uk, entry in me_obj.get("u", {}).items():
                me_users[uk] = _merge_me(me_users[uk], entry) if uk in me_users else list(entry)

    if not fe_users:
        log.info("No flag-eval rollup data for %s/%s (dates: %s … %s)",
                 env_id, flag_key, dates[0], dates[-1])
        return {}

    # Join FE + ME by userKey, group by variant
    # variant → {n, k, sum, count}
    variants: dict[str, dict] = {}
    for uk, fe in fe_users.items():
        variant = fe[1]   # index 1 = variant string
        if variant not in variants:
            variants[variant] = {"n": 0, "k": 0, "sum": 0.0, "count": 0}
        g = variants[variant]
        g["n"] += 1
        me = me_users.get(uk)
        if me and me[0] == 1:   # hasConversion
            g["k"]     += 1
            g["sum"]   += me[5]
            g["count"] += me[6]

    # Return in proportion format { "n": N, "k": K }
    return {
        metric_event: {
            variant: {"n": stats["n"], "k": stats["k"]}
            for variant, stats in variants.items()
        }
    }
