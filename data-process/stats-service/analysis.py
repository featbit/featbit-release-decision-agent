"""
Analysis orchestration.

analyze_all_running() — called periodically; analyzes every running ExperimentRun.
analyze_run(run)      — aggregate R2 data + run Bayesian or Bandit + save to DB.
"""

import json
import logging
from datetime import date, datetime, timezone

from db import get_running_experiments, save_analysis_result
from r2 import aggregate_experiment
from stats_utils import GaussianPrior, extract_guardrails
from bayesian import compute_bayesian
from bandit import compute_bandit_result

log = logging.getLogger(__name__)


def analyze_all_running() -> None:
    runs = get_running_experiments()
    log.info("Analyzing %d running experiment run(s)", len(runs))
    for run in runs:
        try:
            analyze_run(run)
        except Exception as exc:
            log.error("Failed to analyze run %s: %s", run.get("id"), exc, exc_info=True)


def analyze_run(run: dict) -> dict:
    """
    Run Bayesian or Bandit analysis for one ExperimentRun.
    Saves the result to DB and returns it.
    """
    run_id       = run["id"]
    method       = (run.get("method") or "bayesian").lower()
    env_id       = run["env_id"]
    flag_key     = run["flag_key"]
    metric_event = run["primary_metric_event"]
    control      = run.get("control_variant") or "control"
    treatment_raw = run.get("treatment_variant") or "treatment"
    treatments   = [t.strip() for t in treatment_raw.split(",") if t.strip()]
    min_sample   = int(run.get("minimum_sample") or 0)
    guardrails   = _parse_guardrails(run.get("guardrail_events"))

    # Parse observation window
    start_date = _to_date(run.get("observation_start")) or date.today()
    end_date   = _to_date(run.get("observation_end"))

    prior = GaussianPrior(
        mean     = float(run.get("prior_mean")   or 0.0),
        variance = float(run.get("prior_stddev") or 0.3) ** 2,
        proper   = bool(run.get("prior_proper")  or False),
    )

    # Aggregate R2 rollup data into metrics_data
    metrics_data = aggregate_experiment(
        env_id            = env_id,
        flag_key          = flag_key,
        metric_event      = metric_event,
        observation_start = start_date,
        observation_end   = end_date,
    )

    now = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")

    if not metrics_data:
        result = {"error": "no rollup data found", "computed_at": now, "run_id": run_id}
        save_analysis_result(run_id, json.dumps(result))
        return result

    all_variants = [control] + treatments
    start_lbl = start_date.isoformat()
    end_lbl   = end_date.isoformat() if end_date else "open"

    if method == "bandit":
        result = compute_bandit_result(
            metrics_data  = metrics_data,
            all_arms      = all_variants,
            prior         = prior,
            primary_event = metric_event,
            run_id        = run_id,
        )
    else:
        result = compute_bayesian(
            metrics_data       = metrics_data,
            control            = control,
            treatments         = treatments,
            prior              = prior,
            primary_event      = metric_event,
            guardrail_events   = guardrails,
            min_sample         = min_sample,
            observation_start  = start_lbl,
            observation_end    = end_lbl,
            run_id             = run_id,
        )

    save_analysis_result(run_id, json.dumps(result))
    log.info("Analyzed run %s (%s): %s", run_id, method, result.get("computed_at", ""))
    return result


# ── Helpers ───────────────────────────────────────────────────────────────────

def _to_date(val) -> date | None:
    if val is None:
        return None
    if isinstance(val, date):
        return val if not isinstance(val, datetime) else val.date()
    if isinstance(val, datetime):
        return val.date()
    try:
        return date.fromisoformat(str(val)[:10])
    except ValueError:
        return None


def _parse_guardrails(raw) -> list[str]:
    if not raw:
        return []
    if isinstance(raw, list):
        return list(raw)
    s = str(raw).strip()
    if s.startswith("["):
        try:
            return json.loads(s)
        except Exception:
            pass
    return [x.strip() for x in s.split(",") if x.strip()]
