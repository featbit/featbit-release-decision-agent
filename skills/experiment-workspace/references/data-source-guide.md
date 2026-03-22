# Data Source Guide

How to produce `input.json` for the experiment analysis.

The analysis script needs two numbers per variant per metric — `n` (unique users exposed) and `k` (unique users who converted). How you obtain those numbers depends on your infrastructure. This guide covers three patterns.

---

## Input Contract

`input.json` lives at `.featbit-release-decision/experiments/<slug>/input.json`:

```json
{
  "metrics": {
    "click_start_chat": {
      "false": {"n": 1234, "k": 89},
      "true":  {"n": 1198, "k": 112}
    },
    "error_rate": {
      "false": {"n": 1234, "k": 12},
      "true":  {"n": 1198, "k": 19}
    }
  }
}
```

Keys:
- Outer keys are metric event names — must match `primary_metric_event` and `guardrail_events` in `definition.md`
- Inner keys are variant values — must match `variants.control` and `variants.treatment` in `definition.md`
- `n` = unique users exposed to that variant in the observation window
- `k` = unique users who fired the metric event at least once, out of those `n`

---

## How to Produce `input.json`

Open `collect-input.py` (at `.featbit-release-decision/scripts/collect-input.py`), implement the one function `fetch_metric_summary()` using whichever pattern fits your infrastructure below, then run:

```bash
python .featbit-release-decision/scripts/collect-input.py <slug>
```

The script reads `definition.md`, calls `fetch_metric_summary()` once per variant × metric combination, and writes `input.json`.

---

## §FeatBit — Experiment Results API

If your FeatBit instance has an experiment results endpoint, it already computes `(n, k)` server-side. No raw exports needed.

```python
import os, requests

FEATBIT_API_BASE  = os.environ["FEATBIT_API_BASE"]   # e.g. https://your-featbit.example.com
FEATBIT_API_TOKEN = os.environ["FEATBIT_API_TOKEN"]
ENV_ID            = os.environ["FEATBIT_ENV_ID"]

def fetch_metric_summary(flag_key, variant, metric, start, end):
    url = f"{FEATBIT_API_BASE}/api/v1/envs/{ENV_ID}/experiments/results"
    resp = requests.get(
        url,
        headers={"Authorization": f"Bearer {FEATBIT_API_TOKEN}"},
        params={
            "flagKey": flag_key,
            "metric":  metric,
            "variant": variant,
            "from":    start,
            "to":      end,
        },
        timeout=30,
    )
    resp.raise_for_status()
    body = resp.json()
    return body["exposed"], body["converted"]
```

Consult your FeatBit instance's REST API docs for the exact endpoint and response field names — they may vary by version. Install `requests` if needed: `pip install requests`.

---

## §Database — SQL Aggregation

If your application logs flag evaluations and analytics events to its own database, a single aggregating query can return `(n, k)` directly without exporting raw rows.

```python
import os, psycopg2

DB_DSN = os.environ["DATABASE_URL"]  # postgres://user:pass@host/db

def fetch_metric_summary(flag_key, variant, metric, start, end):
    sql = """
        SELECT
            COUNT(DISTINCT e.user_key)                                       AS n,
            COUNT(DISTINCT CASE WHEN ev.user_key IS NOT NULL
                                THEN e.user_key END)                         AS k
        FROM flag_evaluations e
        LEFT JOIN analytics_events ev
               ON ev.user_key   = e.user_key
              AND ev.event_name = %(metric)s
              AND ev.fired_at  >= %(start)s
              AND (%(end)s = 'open' OR ev.fired_at < %(end)s)
        WHERE e.flag_key     = %(flag_key)s
          AND e.variant      = %(variant)s
          AND e.evaluated_at >= %(start)s
          AND (%(end)s = 'open' OR e.evaluated_at < %(end)s)
    """
    with psycopg2.connect(DB_DSN) as conn, conn.cursor() as cur:
        cur.execute(sql, {"flag_key": flag_key, "variant": variant,
                          "metric": metric, "start": start, "end": end})
        n, k = cur.fetchone()
    return int(n), int(k)
```

Adapt `flag_evaluations` and `analytics_events` to your actual table and column names. Install `psycopg2-binary` if needed: `pip install psycopg2-binary`.

---

## §Custom — Your Own Metrics Service

If your team has an internal metrics API that already tracks funnel data, call it directly.

```python
import os, requests

METRICS_API_BASE  = os.environ["METRICS_API_BASE"]
METRICS_API_TOKEN = os.environ["METRICS_API_TOKEN"]

def fetch_metric_summary(flag_key, variant, metric, start, end):
    resp = requests.post(
        f"{METRICS_API_BASE}/v1/experiment-summary",
        headers={"Authorization": f"Bearer {METRICS_API_TOKEN}"},
        json={
            "experiment_id": flag_key,
            "group":         variant,
            "event":         metric,
            "period":        {"from": start, "to": end},
        },
        timeout=30,
    )
    resp.raise_for_status()
    body = resp.json()
    return body["unique_users"], body["unique_converters"]
```

Replace the endpoint, headers, and response field names with your service's actual API contract.

---

## Verifying Your Input

Print and sanity-check `input.json` before running analysis:

```bash
cat .featbit-release-decision/experiments/<slug>/input.json
```

Check:
- Both variant keys match `variants.control` and `variants.treatment` in `definition.md`
- `n` values are plausible — not 0, not absurdly high
- `k` ≤ `n` for every row
- All metrics in `definition.md` are present

Then run:

```bash
bash .featbit-release-decision/scripts/check-sample.sh <slug>
python .featbit-release-decision/scripts/analyze-bayesian.py <slug>
```

See `analysis-bayesian.md` for output format and interpretation.

