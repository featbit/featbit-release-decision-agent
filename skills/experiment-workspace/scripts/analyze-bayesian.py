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
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
from scipy.stats import chi2 as chi2_dist
from scipy.stats import norm
from scipy.stats import truncnorm

ALPHA = 0.05                      # credible interval = 1 − ALPHA


@dataclass
class GaussianPrior:
    """
    Gaussian prior on the relative effect δ = (mean_b − mean_a) / mean_a.

    proper=False  → flat/improper prior (default); posterior = data likelihood only.
    proper=True   → informative prior; posterior is the precision-weighted average
                    of the prior and the data estimate (conjugate Gaussian update).

    Recommended defaults when enabling a proper prior:
        mean   = 0.0   (no expected direction)
        stddev = 0.3   (±30% relative lift is the plausible range)
    """
    mean: float = 0.0
    variance: float = 1e10   # effectively flat when proper=False
    proper: bool = False


# ══════════════════════════════════════════════════════════════════════════════
# 1. METRIC MOMENTS
# ══════════════════════════════════════════════════════════════════════════════

def metric_moments(vdata: dict) -> tuple[float, float, int]:
    """
    Return (per-unit mean, per-unit variance, n) from a variant data dict.

    Proportion  {"n": N, "k": K}                      → Bernoulli variance p(1−p)
    Continuous  {"n": N, "sum": S, "sum_squares": SS}  → sample variance
    """
    n = int(vdata.get("n", 0))
    if n == 0:
        return 0.0, 0.0, 0
    if "k" in vdata:
        mean = float(vdata["k"]) / n
        var  = mean * (1.0 - mean)
    else:
        s    = float(vdata.get("sum", 0.0))
        ss   = float(vdata.get("sum_squares", 0.0))
        mean = s / n
        var  = (ss - s * s / n) / (n - 1) if n > 1 else 0.0
    return mean, var, n


# ══════════════════════════════════════════════════════════════════════════════
# 2. BAYESIAN ANALYSIS  (Gaussian posterior, flat / improper prior)
# ══════════════════════════════════════════════════════════════════════════════

def _delta_method_se(
    mean_a: float, var_a: float, n_a: int,
    mean_b: float, var_b: float, n_b: int,
    relative: bool,
) -> float:
    """
    Standard error for (mean_b − mean_a) [absolute] or
    (mean_b − mean_a) / mean_a [relative] via the delta method.
    """
    if relative:
        if mean_a == 0:
            return 0.0
        return float(np.sqrt(
            var_b / (n_b * mean_a ** 2)
            + var_a * mean_b ** 2 / (n_a * mean_a ** 4)
        ))
    return float(np.sqrt(var_b / n_b + var_a / n_a))


def _truncated_normal_mean(mu: float, sigma: float, a: float, b: float) -> float:
    """E[X | a < X ≤ b] for X ~ N(mu, sigma²)."""
    alpha_tn = (a - mu) / sigma
    beta_tn  = (b - mu) / sigma
    return float(truncnorm.stats(alpha_tn, beta_tn, loc=mu, scale=sigma, moments="m"))


def _risk(mu: float, sigma: float) -> tuple[float, float]:
    """
    (risk_ctrl, risk_trt) where δ ~ N(mu, sigma²) is the relative treatment effect.

    risk_ctrl = E[max(0, δ)]  — expected opportunity cost of keeping control
                                when treatment is actually better.
    risk_trt  = E[max(0,−δ)] — expected loss from adopting treatment
                                when control is actually better.

    Both values are in the same unit as the relative effect (fractions, not %).
    """
    p_ctrl_better = float(norm.cdf(0.0, loc=mu, scale=sigma))
    mn_neg = _truncated_normal_mean(mu, sigma, -np.inf, 0.0)
    mn_pos = _truncated_normal_mean(mu, sigma,  0.0, np.inf)
    return float((1.0 - p_ctrl_better) * mn_pos), float(-p_ctrl_better * mn_neg)


def bayesian_result(
    mean_a: float, var_a: float, n_a: int,
    mean_b: float, var_b: float, n_b: int,
    inverse: bool = False,
    prior: GaussianPrior | None = None,
) -> dict:
    """
    Analytical Gaussian-posterior Bayesian A/B test.

    When prior is None or prior.proper is False: flat/improper prior — posterior equals
    the data likelihood (original behaviour, fully backward-compatible).

    When prior.proper is True: applies a conjugate Gaussian prior-posterior update.
    The posterior is the precision-weighted average of the prior and the data estimate:

        post_prec  = 1/data_var + 1/prior.variance
        post_mean  = (data_mean/data_var + prior.mean/prior.variance) / post_prec
        post_std   = sqrt(1 / post_prec)

    Effect: with small samples the result is pulled toward the prior mean; as n grows
    the data dominates and the prior is "washed out".  prior.mean = 0, prior.stddev = 0.3
    This encodes "most experiments have a lift between −30% and +30%".

    Returns a dict with:
      chance_to_win    P(treatment is better)
      relative_change  posterior mean of (mean_b − mean_a) / mean_a  (fraction)
      absolute_change  mean_b − mean_a  (observed, not posterior-adjusted)
      ci_rel_lower     lower bound of 95 % credible interval (relative, posterior)
      ci_rel_upper     upper bound of 95 % credible interval (relative, posterior)
      risk_ctrl        risk[ctrl]: opportunity cost of keeping control
      risk_trt         risk[trt]:  downside risk of adopting treatment
      prior_applied    True if a proper prior was used
      error            None  or  an error string
    """
    if n_a == 0 or n_b == 0:
        return {"error": "zero sample size"}
    if mean_a == 0:
        return {"error": "control mean is zero — cannot compute relative effect"}

    se_rel = _delta_method_se(mean_a, var_a, n_a, mean_b, var_b, n_b, relative=True)
    if se_rel == 0:
        return {"error": "zero standard error (no variance in data)"}

    mu_rel = (mean_b - mean_a) / mean_a
    mu_abs = mean_b - mean_a

    # ── Conjugate Gaussian prior update ───────────────────────────────────────
    prior_applied = False
    if prior is not None and prior.proper:
        data_prec  = 1.0 / (se_rel ** 2)
        prior_prec = 1.0 / prior.variance
        post_prec  = data_prec + prior_prec
        mu_rel     = (mu_rel * data_prec + prior.mean * prior_prec) / post_prec
        se_rel     = float(np.sqrt(1.0 / post_prec))
        prior_applied = True

    z_half = float(norm.ppf(1.0 - ALPHA / 2))

    ctw = float(norm.sf(0.0, loc=mu_rel, scale=se_rel))   # P(δ_rel > 0)
    if inverse:
        ctw = 1.0 - ctw

    risk_c, risk_t = _risk(mu_rel, se_rel)
    if inverse:
        risk_c, risk_t = risk_t, risk_c   # flip: "winning" direction is reversed

    return {
        "error":           None,
        "chance_to_win":   ctw,
        "relative_change": mu_rel,
        "absolute_change": mu_abs,
        "ci_rel_lower":    mu_rel - z_half * se_rel,
        "ci_rel_upper":    mu_rel + z_half * se_rel,
        "risk_ctrl":       risk_c,
        "risk_trt":        risk_t,
        "prior_applied":   prior_applied,
    }


# ══════════════════════════════════════════════════════════════════════════════
# 3. SRM CHECK  (Sample Ratio Mismatch)
# ══════════════════════════════════════════════════════════════════════════════

def srm_check(observed: list[int], expected_weights: list[float] | None = None) -> float:
    """
    Chi-squared SRM test.  Returns p-value; p < 0.01 is the common alarm threshold.
    expected_weights defaults to equal allocation across all variants.
    """
    total = sum(observed)
    if total == 0:
        return 1.0
    k = len(observed)
    if expected_weights is None:
        expected_weights = [1.0 / k] * k
    total_w = sum(expected_weights)
    chi_sq  = sum(
        (o - w / total_w * total) ** 2 / (w / total_w * total)
        for o, w in zip(observed, expected_weights)
        if w > 0
    )
    return float(chi2_dist.sf(chi_sq, k - 1))


# ══════════════════════════════════════════════════════════════════════════════
# 4. DEFINITION PARSING
# ══════════════════════════════════════════════════════════════════════════════

def load_definition(path: Path) -> tuple[dict, str]:
    """Return (key→value dict, raw markdown text)."""
    text = path.read_text()
    kv = {}
    for line in text.splitlines():
        if line and not line.startswith(" ") and not line.startswith("#") and ":" in line:
            key, _, value = line.partition(":")
            kv[key.strip()] = value.strip()
    return kv, text


def parse_variants(text: str) -> tuple[str, list[str]]:
    """
    Extract (control_value, [treatment_values]) from definition.md.
    Handles both a single  treatment:  key and multiple  treatment_a: / treatment_b:  keys.
    """
    ctrl_m   = re.search(r"^\s+control:\s*(\S+)", text, re.MULTILINE)
    trt_list = re.findall(r"^\s+treatment[^:\n]*:\s*(\S+)", text, re.MULTILINE)
    control    = ctrl_m.group(1) if ctrl_m else "control"
    treatments = trt_list if trt_list else ["treatment"]
    return control, treatments


def parse_prior(text: str) -> GaussianPrior:
    """
    Read optional prior block from definition.md.

    prior:
      proper:  true
      mean:    0.0
      stddev:  0.3

    Defaults to flat/improper prior if the block is absent.
    """
    proper_m = re.search(r"proper:\s*(true|false)", text, re.IGNORECASE)
    mean_m   = re.search(r"(?<=prior:.*\n)(?:.*\n)*?.*mean:\s*(-?[\d.]+)", text)
    # simpler line-by-line parse
    proper, mean, stddev = False, 0.0, 0.3
    in_prior = False
    for line in text.splitlines():
        if re.match(r"^prior\s*:", line):
            in_prior = True
            continue
        if in_prior:
            s = line.strip()
            if not s or (not s.startswith("#") and ":" not in s):
                in_prior = False
                continue
            if s.startswith("#"):
                continue
            key, _, val = s.partition(":")
            key, val = key.strip(), val.strip()
            if key == "proper":
                proper = val.lower() == "true"
            elif key == "mean":
                try:
                    mean = float(val)
                except ValueError:
                    pass
            elif key == "stddev":
                try:
                    stddev = float(val)
                except ValueError:
                    pass
            elif ":" not in line and not line.startswith(" "):
                in_prior = False
    return GaussianPrior(mean=mean, variance=stddev ** 2, proper=proper)


def parse_guardrails(text: str) -> list[str]:
    events: list[str] = []
    in_block = False
    for line in text.splitlines():
        if "guardrail_events:" in line:
            in_block = True
            continue
        if in_block:
            s = line.strip()
            if s.startswith("- "):
                events.append(s[2:].strip())
            elif s and not s.startswith("#"):
                in_block = False
    return events


# ══════════════════════════════════════════════════════════════════════════════
# 5. FORMATTING
# ══════════════════════════════════════════════════════════════════════════════

def _pct(x: float) -> str:
    return f"{x * 100:+.2f}%"


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

    # table header — proportions have two extra columns (conv, rate)
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

    # per-treatment decision hint
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
# 6. MAIN
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
    metrics_data = raw.get("metrics", raw)   # accept both {metrics:{…}} and flat

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
    # The Gaussian posterior approximation requires at least 30 conversions per
    # variant. If k < 30, P(win) and risk values may be unreliable even when n
    # passes the minimum_sample_per_variant floor (which is computed from an
    # estimated baseline rate that may differ from the actual observed rate).
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
