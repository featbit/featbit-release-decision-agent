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
    python .featbit-release-decision/scripts/analyze-bayesian.py <experiment-slug>

Reads:
    .featbit-release-decision/experiments/<slug>/definition.md
    .featbit-release-decision/experiments/<slug>/input.json

Writes:
    .featbit-release-decision/experiments/<slug>/analysis.md

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
"""

import json
import re
import sys
from datetime import datetime, timezone
from pathlib import Path

from stats_utils import (
    ALPHA,
    GaussianPrior,
    _pct,
    bayesian_result,
    load_definition,
    metric_moments,
    parse_guardrails,
    parse_prior,
    parse_variants,
    srm_check,
)


# ══════════════════════════════════════════════════════════════════════════════
# FORMATTING
# ══════════════════════════════════════════════════════════════════════════════

def format_metric_section(
    label: str,
    mdata: dict,
    control: str,
    treatments: list[str],
    is_guardrail: bool = False,
    prior: GaussianPrior | None = None,
) -> str:
    """
    Render one metric block as a Markdown table with Bayesian columns.

    Columns:
      variant | n | [conv | rate]  | rel Δ | 95% credible CI | P(win)
            | risk[ctrl] | risk[trt]

    risk[ctrl] = opportunity cost of keeping control (want this low to stay).
    risk[trt]  = downside risk of adopting treatment (want this low to ship).
    Both values are relative (e.g. 0.003 = 0.3 % of the control mean).
    """
    heading  = "### Guardrail" if is_guardrail else "### Primary Metric"
    inverse  = bool(mdata.get("inverse", False))
    ctrl_raw = mdata.get(control, {})
    if not ctrl_raw or not isinstance(ctrl_raw, dict):
        return f"{heading}: {label}\n\n_no data for control variant '{control}'_\n\n"

    mean_a, var_a, n_a = metric_moments(ctrl_raw)
    is_prop = "k" in ctrl_raw
    kind    = ("proportion" if is_prop else "continuous") + (" · inverse (lower is better)" if inverse else "")

    lines = [f"{heading}: {label}", "", f"_type: {kind}_", ""]

    if is_prop:
        h1  = "| variant | n | conv | rate | rel Δ | 95% credible CI | P(win) | risk[ctrl] | risk[trt] |"
        sep = "|---------|---|------|------|-------|-----------------|--------|------------|-----------|"
        ctrl_row = (
            f"| **{control}** | {n_a:,} | {int(ctrl_raw.get('k', 0)):,} | {mean_a:.3%}"
            " | — | — | — | — | — |"
        )
    else:
        h1  = "| variant | n | mean | rel Δ | 95% credible CI | P(win) | risk[ctrl] | risk[trt] |"
        sep = "|---------|---|------|-------|-----------------|--------|------------|-----------|"
        ctrl_row = (
            f"| **{control}** | {n_a:,} | {mean_a:.4f}"
            " | — | — | — | — | — |"
        )

    lines += [h1, sep, ctrl_row]

    for trt in treatments:
        trt_raw = mdata.get(trt, {})
        if not trt_raw or not isinstance(trt_raw, dict):
            dash = " — |" * (11 if is_prop else 10)
            lines.append(f"| **{trt}** |{dash}")
            continue

        mean_b, var_b, n_b = metric_moments(trt_raw)
        bay  = bayesian_result(mean_a, var_a, n_a, mean_b, var_b, n_b, inverse, prior)

        if bay.get("error"):
            lines.append(f"| **{trt}** | {n_b:,} | — | _error: {bay['error']}_ |")
            continue

        ci_str = f"[{_pct(bay['ci_rel_lower'])}, {_pct(bay['ci_rel_upper'])}]"

        if is_prop:
            lines.append(
                f"| **{trt}** | {n_b:,} | {int(trt_raw.get('k', 0)):,} | {mean_b:.3%} |"
                f" {_pct(bay['relative_change'])} | {ci_str} |"
                f" {bay['chance_to_win']:.1%} |"
                f" {bay['risk_ctrl']:.4f} | {bay['risk_trt']:.4f} |"
            )
        else:
            lines.append(
                f"| **{trt}** | {n_b:,} | {mean_b:.4f} |"
                f" {_pct(bay['relative_change'])} | {ci_str} |"
                f" {bay['chance_to_win']:.1%} |"
                f" {bay['risk_ctrl']:.4f} | {bay['risk_trt']:.4f} |"
            )

    lines.append("")

    for trt in treatments:
        trt_raw = mdata.get(trt, {})
        if not trt_raw or not isinstance(trt_raw, dict):
            continue
        mean_b, var_b, n_b = metric_moments(trt_raw)
        bay  = bayesian_result(mean_a, var_a, n_a, mean_b, var_b, n_b, inverse, prior)
        if bay.get("error"):
            continue

        ctw    = bay["chance_to_win"]
        rc, rt = bay["risk_ctrl"], bay["risk_trt"]
        prefix = f"**{trt}**: " if len(treatments) > 1 else ""

        if ctw >= 0.95 and not is_guardrail:
            hint = "strong signal → adopt treatment"
        elif ctw >= 0.80 and not is_guardrail:
            hint = "leaning treatment"
        elif ctw <= 0.05 and not is_guardrail:
            hint = "treatment appears harmful"
        elif ctw <= 0.20 and not is_guardrail:
            hint = "leaning control"
        else:
            hint = "inconclusive"

        lines.append(
            f"> {prefix}P(win)={ctw:.0%}  "
            f"risk[ctrl]={rc:.4f}  risk[trt]={rt:.4f}  → {hint}"
        )

    lines.append("")
    return "\n".join(lines)


# ══════════════════════════════════════════════════════════════════════════════
# MAIN
# ══════════════════════════════════════════════════════════════════════════════

def main(slug: str) -> None:
    base = Path(".featbit-release-decision") / "experiments" / slug
    defn, text = load_definition(base / "definition.md")

    input_path = base / "input.json"
    if not input_path.exists():
        print(f"ERROR: {input_path} not found.")
        print("Collect input data first:")
        print(f"  python .featbit-release-decision/scripts/collect-input.py {slug}")
        sys.exit(1)

    raw          = json.loads(input_path.read_text())
    metrics_data = raw.get("metrics", raw)

    control, treatments = parse_variants(text)
    guardrail_events    = parse_guardrails(text)
    prior               = parse_prior(text)
    primary_event       = defn.get("primary_metric_event", "")
    min_sample          = int(defn.get("minimum_sample_per_variant", 0) or 0)

    now       = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    start_raw = re.search(r"start:\s*(\S+)", text)
    end_raw   = re.search(r"end:\s*(\S+)",   text)
    start_lbl = start_raw.group(1) if start_raw else "?"
    end_lbl   = end_raw.group(1)   if end_raw   else "open"

    all_variants = [control] + treatments

    # ── SRM check ──────────────────────────────────────────────────────────
    srm_block = ""
    if primary_event and primary_event in metrics_data:
        pm = metrics_data[primary_event]
        ns = [
            pm.get(v, {}).get("n", 0)
            for v in all_variants
            if isinstance(pm.get(v), dict)
        ]
        if len(ns) >= 2 and sum(ns) > 0:
            srm_p   = srm_check(ns)
            srm_tag = (
                "⚠ POSSIBLE IMBALANCE — investigate before interpreting results"
                if srm_p < 0.01 else "✓ ok"
            )
            srm_block = (
                "## SRM (Sample Ratio Mismatch)\n"
                f"χ² p-value: **{srm_p:.4f}** {srm_tag}\n"
                f"observed n: {', '.join(f'{v}={n}' for v, n in zip(all_variants, ns))}\n"
            )

    # ── Sample size check ───────────────────────────────────────────────────
    primary_md = metrics_data.get(primary_event, {}) if primary_event else {}
    ctrl_n     = primary_md.get(control, {}).get("n", 0) if primary_md else 0
    min_trt_n  = min(
        (primary_md.get(t, {}).get("n", 0) for t in treatments if primary_md),
        default=0,
    )
    sample_ok   = (min(ctrl_n, min_trt_n) >= min_sample) if min_sample > 0 else True
    sample_mark = (
        "✓" if sample_ok
        else f"✗  (got {min(ctrl_n, min_trt_n)}, need {min_sample})"
    )

    # ── Gaussian approximation validity check (k ≥ 30 per variant) ──────────
    approx_warnings: list[str] = []
    if primary_md:
        for v in all_variants:
            vdata = primary_md.get(v, {})
            if isinstance(vdata, dict) and "k" in vdata:
                k_val = int(vdata.get("k", 0))
                if k_val < 30:
                    approx_warnings.append(
                        f"  ⚠ {v}: only {k_val} conversions "
                        f"— Gaussian approximation unreliable (need ≥ 30)"
                    )

    # ── Assemble document ───────────────────────────────────────────────────
    prior_label = (
        f"proper (mean={prior.mean}, stddev={prior.variance ** 0.5:.3g})"
        if prior.proper else "flat/improper (data-only)"
    )
    out_lines = [
        f"experiment:   {slug}",
        f"computed_at:  {now}",
        f"window:       {start_lbl} → {end_lbl}",
        f"control:      {control}",
        f"treatments:   {', '.join(treatments)}",
        f"prior:        {prior_label}",
        "",
    ]

    if srm_block:
        out_lines.append(srm_block)

    if primary_event and primary_event in metrics_data:
        out_lines.append(format_metric_section(
            primary_event, metrics_data[primary_event],
            control, treatments, is_guardrail=False, prior=prior,
        ))

    for g in guardrail_events:
        if g in metrics_data:
            out_lines.append(format_metric_section(
                g, metrics_data[g],
                control, treatments, is_guardrail=True, prior=prior,
            ))

    out_lines += [
        "## Sample check",
        f"minimum required per variant: {min_sample}  {sample_mark}",
        f"control ({control}) exposed:   {ctrl_n}",
    ] + [
        f"{trt} exposed:   {primary_md.get(trt, {}).get('n', 0) if primary_md else 0}"
        for trt in treatments
    ]

    if approx_warnings:
        out_lines += ["", "**Gaussian approximation warning** — too few conversions:"] + approx_warnings
        out_lines.append("Do not act on P(win) or risk values until conversions reach ≥ 30 per variant.")

    out_path = base / "analysis.md"
    out_path.write_text("\n".join(out_lines) + "\n")
    print(f"Written: {out_path}")
    if not sample_ok:
        print("WARNING: sample size below minimum — treat results as indicative only.")
    if approx_warnings:
        print("WARNING: fewer than 30 conversions in at least one variant — Gaussian approximation unreliable.")


if __name__ == "__main__":
    if len(sys.argv) != 2:
        print("Usage: python analyze-bayesian.py <experiment-slug>")
        sys.exit(1)
    main(sys.argv[1])
