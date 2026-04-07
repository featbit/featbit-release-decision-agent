#!/usr/bin/env python3
"""
ROLE: READY-TO-RUN — copy to project and run as-is. Do not modify.

Bayesian A/B experiment analysis script.

Implements:
  • Analytical Gaussian Bayesian analysis (chance to win, 95% credible interval,
    risk / expected loss)
  • Sample Ratio Mismatch (SRM) check
  • Continuous metrics (mean / variance) in addition to conversion rates
  • Inverse metrics (lower is better, e.g. error_rate, latency)
  • Multiple treatment arms

Usage:
    python skills/experiment-workspace/scripts/analyze-bayesian.py <project-id> <experiment-slug>

Reads:
    Experiment record from the database via HTTP API (inputData, definition fields)

Writes:
    analysisResult back to the database via HTTP API

Requirements:
    pip install numpy scipy

──────────────────────────────────────────────────────────────────────────────
INPUT FORMAT  (input.json → metrics → <metric-name>)
──────────────────────────────────────────────────────────────────────────────
Proportion metric (conversion rate, click-through rate …):
    "<variant>": {"n": 1000, "k": 120}

Continuous metric (revenue, duration, score …):
    "<variant>": {"n": 1000, "sum": 5000.0, "sum_squares": 27500.0}

Inverse metric — add  "inverse": true  at the metric level (same level as
variant keys):
    "error_rate": {
        "inverse": true,
        "control": {"n": 1000, "k": 18},
        "treatment": {"n": 1020, "k": 15}
    }

Multiple treatment arms — add more variant keys matching definition.md.
──────────────────────────────────────────────────────────────────────────────
OUTPUT FORMAT  (analysis.json)
──────────────────────────────────────────────────────────────────────────────
{
  "type": "bayesian",
  "experiment": "<slug>",
  "computed_at": "ISO-8601",
  "window": {"start": "...", "end": "..."},
  "control": "<variant>",
  "treatments": ["<variant>", ...],
  "prior": "<label>",
  "srm": {"chi2_p_value": 0.31, "ok": true, "observed": {"a": 612, "b": 588}},
  "primary_metric": { ... metric section ... },
  "guardrails": [ ... metric sections ... ],
  "sample_check": {"minimum_per_variant": 400, "ok": true, "variants": {...}}
}
──────────────────────────────────────────────────────────────────────────────
"""

import json
import sys
from datetime import datetime, timezone

from db_client import get_experiment, upsert_experiment
from stats_utils import (
    ALPHA,
    GaussianPrior,
    bayesian_result,
    extract_guardrails,
    extract_prior,
    extract_variants,
    metric_moments,
    srm_check,
)


# ══════════════════════════════════════════════════════════════════════════════
# METRIC RESULT (returns structured dict)
# ══════════════════════════════════════════════════════════════════════════════

def compute_metric_section(
    label: str,
    mdata: dict,
    control: str,
    treatments: list[str],
    is_guardrail: bool = False,
    prior: GaussianPrior | None = None,
) -> dict | None:
    """
    Compute one metric block as a structured dict.

    Returns a dict with:
      event, metric_type, inverse, rows[], verdict
    """
    inverse  = bool(mdata.get("inverse", False))
    ctrl_raw = mdata.get(control, {})
    if not ctrl_raw or not isinstance(ctrl_raw, dict):
        return None

    mean_a, var_a, n_a = metric_moments(ctrl_raw)
    is_prop = "k" in ctrl_raw
    kind    = "proportion" if is_prop else "continuous"

    rows = []
    # Control row
    ctrl_row: dict = {"variant": control, "n": n_a, "is_control": True}
    if is_prop:
        ctrl_row["conversions"] = int(ctrl_raw.get("k", 0))
        ctrl_row["rate"] = round(mean_a, 6)
    else:
        ctrl_row["mean"] = round(mean_a, 4)
    rows.append(ctrl_row)

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

        if bay.get("error"):
            rows.append(trt_row)
            continue

        trt_row["rel_delta"]  = round(bay["relative_change"], 6)
        trt_row["ci_lower"]   = round(bay["ci_rel_lower"], 6)
        trt_row["ci_upper"]   = round(bay["ci_rel_upper"], 6)

        if is_guardrail:
            trt_row["p_harm"]     = round(1.0 - bay["chance_to_win"], 4)
            trt_row["risk_ctrl"]  = round(bay["risk_ctrl"], 6)
            trt_row["risk_trt"]   = round(bay["risk_trt"], 6)
        else:
            trt_row["p_win"]      = round(bay["chance_to_win"], 4)
            trt_row["risk_ctrl"]  = round(bay["risk_ctrl"], 6)
            trt_row["risk_trt"]   = round(bay["risk_trt"], 6)

        rows.append(trt_row)

        # Generate verdict
        ctw = bay["chance_to_win"]
        prefix = f"{trt}: " if len(treatments) > 1 else ""
        if is_guardrail:
            p_harm = 1.0 - ctw
            if p_harm < 0.1:
                verdicts.append(f"{prefix}guardrail healthy")
            elif p_harm < 0.3:
                verdicts.append(f"{prefix}guardrail borderline — monitor")
            else:
                verdicts.append(f"{prefix}guardrail ALARM — possible regression")
        else:
            if ctw >= 0.95:
                verdicts.append(f"{prefix}strong signal → adopt treatment")
            elif ctw >= 0.80:
                verdicts.append(f"{prefix}leaning treatment")
            elif ctw <= 0.05:
                verdicts.append(f"{prefix}treatment appears harmful")
            elif ctw <= 0.20:
                verdicts.append(f"{prefix}leaning control")
            else:
                verdicts.append(f"{prefix}inconclusive")

    section: dict = {
        "event": label,
        "metric_type": kind,
        "rows": rows,
        "verdict": "; ".join(verdicts) if verdicts else "no data",
    }
    if inverse:
        section["inverse"] = True

    return section


# ══════════════════════════════════════════════════════════════════════════════
# MAIN
# ══════════════════════════════════════════════════════════════════════════════

def main(project_id: str, slug: str) -> None:
    experiment = get_experiment(project_id, slug)

    raw_input = experiment.get("inputData")
    if not raw_input:
        print("ERROR: inputData is empty in the experiment record.")
        print("Collect input data first:")
        print(f"  npx tsx skills/experiment-workspace/scripts/collect-input.ts {project_id} {slug}")
        sys.exit(1)

    raw          = json.loads(raw_input) if isinstance(raw_input, str) else raw_input
    metrics_data = raw.get("metrics", raw)

    control, treatments = extract_variants(experiment)
    guardrail_events    = extract_guardrails(experiment)
    prior               = extract_prior(experiment)
    primary_event       = experiment.get("primaryMetricEvent") or ""
    min_sample          = int(experiment.get("minimumSample") or 0)

    now       = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    start_raw = experiment.get("observationStart")
    end_raw   = experiment.get("observationEnd")
    start_lbl = start_raw[:10] if start_raw else "?"
    end_lbl   = end_raw[:10] if end_raw else "open"

    all_variants = [control] + treatments

    # ── Prior label ──────────────────────────────────────────────────────────
    prior_label = (
        f"proper (mean={prior.mean}, stddev={prior.variance ** 0.5:.3g})"
        if prior.proper else "flat/improper (data-only)"
    )

    # ── SRM check ──────────────────────────────────────────────────────────
    srm_result = {"chi2_p_value": 0.0, "ok": True, "observed": {}}
    if primary_event and primary_event in metrics_data:
        pm = metrics_data[primary_event]
        ns = [
            pm.get(v, {}).get("n", 0)
            for v in all_variants
            if isinstance(pm.get(v), dict)
        ]
        if len(ns) >= 2 and sum(ns) > 0:
            srm_p = srm_check(ns)
            srm_result = {
                "chi2_p_value": round(srm_p, 4),
                "ok": srm_p >= 0.01,
                "observed": {v: n for v, n in zip(all_variants, ns)},
            }

    # ── Primary metric ───────────────────────────────────────────────────────
    primary_section = None
    if primary_event and primary_event in metrics_data:
        primary_section = compute_metric_section(
            primary_event, metrics_data[primary_event],
            control, treatments, is_guardrail=False, prior=prior,
        )

    # ── Guardrails ───────────────────────────────────────────────────────────
    guardrails = []
    for g in guardrail_events:
        if g in metrics_data:
            section = compute_metric_section(
                g, metrics_data[g],
                control, treatments, is_guardrail=True, prior=prior,
            )
            if section:
                guardrails.append(section)

    # ── Sample size check ───────────────────────────────────────────────────
    primary_md = metrics_data.get(primary_event, {}) if primary_event else {}
    variant_ns = {}
    for v in all_variants:
        variant_ns[v] = primary_md.get(v, {}).get("n", 0) if primary_md else 0
    min_observed = min(variant_ns.values()) if variant_ns else 0
    sample_ok    = (min_observed >= min_sample) if min_sample > 0 else True

    # ── Assemble output ──────────────────────────────────────────────────────
    output: dict = {
        "type": "bayesian",
        "experiment": slug,
        "computed_at": now,
        "window": {"start": start_lbl, "end": end_lbl},
        "control": control,
        "treatments": treatments,
        "prior": prior_label,
        "srm": srm_result,
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

    # ── Write to DB ──────────────────────────────────────────────────────────
    upsert_experiment(project_id, slug, {
        "analysisResult": json.dumps(output),
        "status": "analyzing",
    })
    print(f"Written analysisResult to DB for experiment: {slug}")
    if not sample_ok:
        print("WARNING: sample size below minimum — treat results as indicative only.")
    if not srm_result["ok"]:
        print("WARNING: SRM detected — traffic split is uneven. Investigate before interpreting.")


if __name__ == "__main__":
    if len(sys.argv) != 3:
        print("Usage: python analyze-bayesian.py <project-id> <experiment-slug>")
        sys.exit(1)
    main(sys.argv[1], sys.argv[2])
