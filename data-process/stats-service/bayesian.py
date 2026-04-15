"""
Bayesian A/B analysis — pure computation module (no CLI, no DB calls).

Core logic adapted from skills/experiment-workspace/scripts/analyze-bayesian.py.
"""

from datetime import datetime, timezone

from stats_utils import (
    ALPHA,
    GaussianPrior,
    bayesian_result,
    metric_moments,
    srm_check,
)


def compute_bayesian(
    metrics_data: dict,
    control: str,
    treatments: list[str],
    prior: GaussianPrior,
    primary_event: str,
    guardrail_events: list[str] | None = None,
    min_sample: int = 0,
    observation_start: str = "?",
    observation_end: str = "open",
    run_id: str = "",
) -> dict:
    """
    Run Bayesian analysis over pre-aggregated metrics data.

    metrics_data format:
        {
          "<event_name>": {
            "<variant>": {"n": int, "k": int}            # proportion
            "<variant>": {"n": int, "sum": ..., "sum_squares": ...}  # continuous
          }
        }

    Returns a structured result dict (same schema as analyze-bayesian.py output).
    """
    guardrail_events = guardrail_events or []
    all_variants = [control] + treatments
    now = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")

    # ── SRM check ─────────────────────────────────────────────────────────────
    srm_result: dict = {"chi2_p_value": 1.0, "ok": True, "observed": {}}
    if primary_event in metrics_data:
        pm = metrics_data[primary_event]
        ns = [pm.get(v, {}).get("n", 0) for v in all_variants if isinstance(pm.get(v), dict)]
        if len(ns) >= 2 and sum(ns) > 0:
            srm_p = srm_check(ns)
            srm_result = {
                "chi2_p_value": round(srm_p, 4),
                "ok": srm_p >= 0.01,
                "observed": {v: n for v, n in zip(all_variants, ns)},
            }

    # ── Primary metric ─────────────────────────────────────────────────────────
    primary_section = None
    if primary_event in metrics_data:
        primary_section = _metric_section(
            primary_event, metrics_data[primary_event],
            control, treatments, is_guardrail=False, prior=prior,
        )

    # ── Guardrails ─────────────────────────────────────────────────────────────
    guardrails = []
    for g in guardrail_events:
        if g in metrics_data:
            section = _metric_section(
                g, metrics_data[g],
                control, treatments, is_guardrail=True, prior=prior,
            )
            if section:
                guardrails.append(section)

    # ── Sample size check ───────────────────────────────────────────────────────
    primary_md = metrics_data.get(primary_event, {})
    variant_ns = {v: primary_md.get(v, {}).get("n", 0) for v in all_variants}
    min_n = min(variant_ns.values()) if variant_ns else 0
    sample_ok = min_n >= min_sample if min_sample > 0 else True

    prior_label = (
        f"proper (mean={prior.mean}, stddev={prior.variance ** 0.5:.3g})"
        if prior.proper else "flat/improper (data-only)"
    )

    output: dict = {
        "type":        "bayesian",
        "run_id":      run_id,
        "computed_at": now,
        "window":      {"start": observation_start, "end": observation_end},
        "control":     control,
        "treatments":  treatments,
        "prior":       prior_label,
        "srm":         srm_result,
    }
    if primary_section:
        output["primary_metric"] = primary_section
    if guardrails:
        output["guardrails"] = guardrails
    output["sample_check"] = {
        "minimum_per_variant": min_sample,
        "ok": sample_ok,
        "variants": variant_ns,
    }
    return output


def _metric_section(
    label: str,
    mdata: dict,
    control: str,
    treatments: list[str],
    is_guardrail: bool,
    prior: GaussianPrior,
) -> dict | None:
    inverse  = bool(mdata.get("inverse", False))
    ctrl_raw = mdata.get(control, {})
    if not ctrl_raw or not isinstance(ctrl_raw, dict):
        return None

    mean_a, var_a, n_a = metric_moments(ctrl_raw)
    is_prop = "k" in ctrl_raw
    kind    = "proportion" if is_prop else "continuous"

    ctrl_row: dict = {"variant": control, "n": n_a, "is_control": True}
    if is_prop:
        ctrl_row["conversions"] = int(ctrl_raw.get("k", 0))
        ctrl_row["rate"] = round(mean_a, 6)
    else:
        ctrl_row["mean"] = round(mean_a, 4)
    rows = [ctrl_row]
    verdicts = []

    for trt in treatments:
        trt_raw = mdata.get(trt, {})
        if not trt_raw or not isinstance(trt_raw, dict):
            continue
        mean_b, var_b, n_b = metric_moments(trt_raw)
        bay = bayesian_result(mean_a, var_a, n_a, mean_b, var_b, n_b, inverse, prior)

        trt_row: dict = {"variant": trt, "n": n_b, "is_control": False}
        if is_prop:
            trt_row["conversions"] = int(trt_raw.get("k", 0))
            trt_row["rate"] = round(mean_b, 6)
        else:
            trt_row["mean"] = round(mean_b, 4)

        if not bay.get("error"):
            trt_row["rel_delta"] = round(bay["relative_change"], 6)
            trt_row["ci_lower"]  = round(bay["ci_rel_lower"], 6)
            trt_row["ci_upper"]  = round(bay["ci_rel_upper"], 6)
            ctw = bay["chance_to_win"]
            prefix = f"{trt}: " if len(treatments) > 1 else ""
            if is_guardrail:
                trt_row["p_harm"]    = round(1.0 - ctw, 4)
                trt_row["risk_ctrl"] = round(bay["risk_ctrl"], 6)
                trt_row["risk_trt"]  = round(bay["risk_trt"], 6)
                p_harm = 1.0 - ctw
                if p_harm < 0.1:   verdicts.append(f"{prefix}guardrail healthy")
                elif p_harm < 0.3: verdicts.append(f"{prefix}guardrail borderline — monitor")
                else:              verdicts.append(f"{prefix}guardrail ALARM — possible regression")
            else:
                trt_row["p_win"]     = round(ctw, 4)
                trt_row["risk_ctrl"] = round(bay["risk_ctrl"], 6)
                trt_row["risk_trt"]  = round(bay["risk_trt"], 6)
                if ctw >= 0.95:   verdicts.append(f"{prefix}strong signal → adopt treatment")
                elif ctw >= 0.80: verdicts.append(f"{prefix}leaning treatment")
                elif ctw <= 0.05: verdicts.append(f"{prefix}treatment appears harmful")
                elif ctw <= 0.20: verdicts.append(f"{prefix}leaning control")
                else:             verdicts.append(f"{prefix}inconclusive")
        rows.append(trt_row)

    section: dict = {
        "event":       label,
        "metric_type": kind,
        "rows":        rows,
        "verdict":     "; ".join(verdicts) if verdicts else "no data",
    }
    if inverse:
        section["inverse"] = True
    return section
