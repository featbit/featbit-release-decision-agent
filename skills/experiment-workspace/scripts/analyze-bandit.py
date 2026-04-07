#!/usr/bin/env python3
"""
ROLE: READY-TO-RUN — copy to project and run as-is. Do not modify.

Thompson Sampling bandit weight computation script.

Reads the current experiment data and outputs recommended traffic weights
for each variant based on their posterior probability of being best.

Algorithm:
  1. Build a Gaussian posterior for each arm from current data (same CLT
     approximation used in analyze-bayesian.py).
  2. Draw 10,000 samples from a multivariate normal across all arm posteriors.
  3. Count how often each arm wins (best_arm_probabilities).
  4. Apply Top-Two strategy: only the top two arms compete for majority traffic;
     all other arms hold a minimum floor weight.
  5. Enforce a minimum floor (default 1%) on every arm so no arm is ever
     completely cut off — early data is noisy and decisions can be corrected.

Burn-in guard:
  Dynamic weighting does not activate until every arm has ≥ 100 users.
  Below this threshold the Gaussian posterior is too uncertain (CLT requires
  ~100 samples), and acting on it would introduce harmful early skew.

Usage:
    python skills/experiment-workspace/scripts/analyze-bandit.py <project-id> <experiment-slug>

Reads:
    Experiment record from the database via HTTP API (inputData, definition fields)

Writes:
    analysisResult back to the database via HTTP API

Requirements:
    pip install numpy scipy
"""

import json
import sys
from datetime import datetime, timezone

import numpy as np

from db_client import get_experiment, upsert_experiment
from stats_utils import (
    GaussianPrior,
    extract_prior,
    extract_variants,
    metric_moments,
    srm_check,
)

MIN_UNITS_PER_ARM = 100   # burn-in: minimum users before dynamic weighting
MIN_ARM_WEIGHT    = 0.01  # floor: no arm ever drops below 1% traffic
N_SAMPLES         = 10_000


# ══════════════════════════════════════════════════════════════════════════════
# POSTERIOR PARAMETERS
# ══════════════════════════════════════════════════════════════════════════════

def _arm_posterior(
    mean: float, var: float, n: int, prior: GaussianPrior
) -> tuple[float, float]:
    """
    Return (posterior_mean, posterior_variance) for a single arm.

    With a flat prior: posterior = data estimate (mean, var/n).
    With a proper prior: precision-weighted average of prior and data.
    """
    if n == 0 or var == 0:
        return prior.mean, prior.variance

    data_var = var / n

    if not prior.proper:
        return mean, data_var

    data_prec  = 1.0 / data_var
    prior_prec = 1.0 / prior.variance
    post_prec  = data_prec + prior_prec
    post_mean  = (mean * data_prec + prior.mean * prior_prec) / post_prec
    post_var   = 1.0 / post_prec
    return post_mean, post_var


# ══════════════════════════════════════════════════════════════════════════════
# TOP-TWO WEIGHTS
# ══════════════════════════════════════════════════════════════════════════════

def _top_two_weights(y: np.ndarray, inverse: bool = False) -> np.ndarray:
    """
    For each row in y (one Monte Carlo draw per arm), count how often each
    arm ranks #1 or #2. Normalize to get traffic weights.

    Top-Two strategy concentrates exploration on the two arms still in
    contention, reducing regret from arms that are already clearly losing.
    """
    n_arms = y.shape[1]
    counts = np.zeros(n_arms)
    sorted_idx = np.argsort(y, axis=1)   # ascending

    if inverse:
        top1 = sorted_idx[:, 0]   # smallest = best
        top2 = sorted_idx[:, 1]
    else:
        top1 = sorted_idx[:, -1]  # largest = best
        top2 = sorted_idx[:, -2]

    for i in range(n_arms):
        counts[i] = np.sum(top1 == i) + np.sum(top2 == i)

    total = counts.sum()
    return counts / total if total > 0 else np.full(n_arms, 1.0 / n_arms)


# ══════════════════════════════════════════════════════════════════════════════
# BANDIT WEIGHT COMPUTATION
# ══════════════════════════════════════════════════════════════════════════════

def compute_bandit_weights(
    arm_names: list[str],
    arm_stats: list[tuple[float, float, int]],  # (mean, variance, n) per arm
    prior: GaussianPrior,
    inverse: bool = False,
    top_two: bool = True,
    seed: int | None = None,
) -> dict:
    """
    Compute Thompson Sampling weights for all arms.

    Returns a dict with:
      enough_units           bool — False during burn-in period
      update_message         human-readable status
      best_arm_probabilities dict arm_name → P(this arm is best)
      bandit_weights         dict arm_name → recommended traffic fraction
      seed                   int  — random seed used (for reproducibility)
    """
    counts = [n for _, _, n in arm_stats]

    # ── Burn-in guard ────────────────────────────────────────────────────────
    if any(n < MIN_UNITS_PER_ARM for n in counts):
        min_n = min(counts)
        return {
            "enough_units": False,
            "update_message": (
                f"burn-in: need ≥ {MIN_UNITS_PER_ARM} users per arm before dynamic weighting "
                f"(current minimum: {min_n})"
            ),
            "best_arm_probabilities": None,
            "bandit_weights": None,
            "seed": None,
        }

    # ── Build posteriors ─────────────────────────────────────────────────────
    post_means = []
    post_vars  = []
    for mean, var, n in arm_stats:
        pm, pv = _arm_posterior(mean, var, n, prior)
        post_means.append(pm)
        post_vars.append(pv)

    # ── Monte Carlo sampling ─────────────────────────────────────────────────
    rng  = np.random.default_rng(seed)
    used_seed = int(rng.integers(0, 1_000_000)) if seed is None else seed
    rng  = np.random.default_rng(used_seed)

    y = rng.multivariate_normal(
        mean=post_means,
        cov=np.diag(post_vars),
        size=N_SAMPLES,
    )   # shape: (N_SAMPLES, n_arms)

    # ── Best-arm probabilities ────────────────────────────────────────────────
    if inverse:
        best_mask = y == y.min(axis=1, keepdims=True)
    else:
        best_mask = y == y.max(axis=1, keepdims=True)
    best_arm_probs = best_mask.mean(axis=0)   # shape: (n_arms,)

    # ── Traffic weights (Top-Two or proportional) ────────────────────────────
    weights = _top_two_weights(y, inverse) if top_two else best_arm_probs.copy()

    # ── Minimum floor ────────────────────────────────────────────────────────
    weights = np.maximum(weights, MIN_ARM_WEIGHT)
    weights /= weights.sum()

    return {
        "enough_units": True,
        "update_message": "successfully updated",
        "best_arm_probabilities": dict(zip(arm_names, best_arm_probs.tolist())),
        "bandit_weights": dict(zip(arm_names, weights.tolist())),
        "seed": used_seed,
    }


# ══════════════════════════════════════════════════════════════════════════════
# MAIN
# ══════════════════════════════════════════════════════════════════════════════

def main(project_id: str, slug: str) -> None:
    experiment = get_experiment(project_id, slug)

    raw_input = experiment.get("inputData")
    if not raw_input:
        print("ERROR: inputData is empty in the experiment record.")
        sys.exit(1)

    raw          = json.loads(raw_input) if isinstance(raw_input, str) else raw_input
    metrics_data = raw.get("metrics", raw)

    control, treatments = extract_variants(experiment)
    prior               = extract_prior(experiment)
    primary_event       = experiment.get("primaryMetricEvent") or ""
    all_arms            = [control] + treatments

    if not primary_event or primary_event not in metrics_data:
        print(f"ERROR: primaryMetricEvent '{primary_event}' not found in inputData")
        sys.exit(1)

    pm      = metrics_data[primary_event]
    inverse = bool(pm.get("inverse", False))

    # ── Collect per-arm stats ────────────────────────────────────────────────
    arm_stats: list[tuple[float, float, int]] = []
    for arm in all_arms:
        vdata = pm.get(arm, {})
        if not isinstance(vdata, dict) or not vdata:
            print(f"ERROR: no data for arm '{arm}' in metric '{primary_event}'")
            sys.exit(1)
        mean, var, n = metric_moments(vdata)
        arm_stats.append((mean, var, n))

    # ── SRM check ────────────────────────────────────────────────────────────
    observed_n = [n for _, _, n in arm_stats]
    srm_p = srm_check(observed_n)
    if srm_p < 0.01:
        print(
            f"WARNING: SRM detected (p={srm_p:.4f}) — traffic split is uneven.\n"
            "Bandit weights are computed but may be unreliable. Investigate before applying."
        )

    # ── Compute weights ───────────────────────────────────────────────────────
    result = compute_bandit_weights(
        arm_names=all_arms,
        arm_stats=arm_stats,
        prior=prior,
        inverse=inverse,
        top_two=True,
    )

    # ── Write to DB ──────────────────────────────────────────────────────────
    output = {
        "type": "bandit",
        "experiment":   slug,
        "computed_at":  datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "metric":       primary_event,
        "srm_p_value":  round(srm_p, 4),
        **result,
    }

    upsert_experiment(project_id, slug, {
        "analysisResult": json.dumps(output),
        "status": "analyzing",
    })
    print(f"Written analysisResult to DB for experiment: {slug}")

    # ── Human-readable summary ────────────────────────────────────────────────
    if result["enough_units"]:
        print(f"\nBest-arm probabilities:")
        for arm, prob in result["best_arm_probabilities"].items():
            print(f"  {arm}: {prob:.1%}")
        print(f"\nRecommended traffic weights:")
        for arm, weight in result["bandit_weights"].items():
            print(f"  {arm}: {weight:.1%}")
    else:
        print(f"\n{result['update_message']}")


if __name__ == "__main__":
    if len(sys.argv) != 3:
        print("Usage: python analyze-bandit.py <project-id> <experiment-slug>")
        sys.exit(1)
    main(sys.argv[1], sys.argv[2])
