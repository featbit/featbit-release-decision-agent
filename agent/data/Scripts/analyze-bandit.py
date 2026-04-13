#!/usr/bin/env python3
"""
Thompson Sampling bandit weight computation script.

Reads the current experiment data and outputs recommended traffic weights
for each variant based on their posterior probability of being best.

Usage:
    python analyze-bandit.py <project-id> <experiment-slug>
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

MIN_UNITS_PER_ARM = 100
MIN_ARM_WEIGHT = 0.01
N_SAMPLES = 10_000


def _arm_posterior(
    mean: float, var: float, n: int, prior: GaussianPrior
) -> tuple[float, float]:
    """Return (posterior_mean, posterior_variance) for a single arm."""
    if n == 0 or var == 0:
        return prior.mean, prior.variance

    data_var = var / n
    if not prior.proper:
        return mean, data_var

    data_prec = 1.0 / data_var
    prior_prec = 1.0 / prior.variance
    post_prec = data_prec + prior_prec
    post_mean = (mean * data_prec + prior.mean * prior_prec) / post_prec
    post_var = 1.0 / post_prec
    return post_mean, post_var


def _top_two_weights(y: np.ndarray, inverse: bool = False) -> np.ndarray:
    """Compute Top-Two Thompson allocation weights from posterior draws."""
    n_arms = y.shape[1]
    counts = np.zeros(n_arms)
    sorted_idx = np.argsort(y, axis=1)

    if inverse:
        top1 = sorted_idx[:, 0]
        top2 = sorted_idx[:, 1]
    else:
        top1 = sorted_idx[:, -1]
        top2 = sorted_idx[:, -2]

    for i in range(n_arms):
        counts[i] = np.sum(top1 == i) + np.sum(top2 == i)

    total = counts.sum()
    return counts / total if total > 0 else np.full(n_arms, 1.0 / n_arms)


def compute_bandit_weights(
    arm_names: list[str],
    arm_stats: list[tuple[float, float, int]],
    prior: GaussianPrior,
    inverse: bool = False,
    top_two: bool = True,
    seed: int | None = None,
) -> dict:
    """Compute Thompson Sampling probabilities and recommended traffic weights."""
    counts = [n for _, _, n in arm_stats]

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

    post_means = []
    post_vars = []
    for mean, var, n in arm_stats:
        pm, pv = _arm_posterior(mean, var, n, prior)
        post_means.append(pm)
        post_vars.append(pv)

    rng = np.random.default_rng(seed)
    used_seed = int(rng.integers(0, 1_000_000)) if seed is None else seed
    rng = np.random.default_rng(used_seed)

    y = rng.multivariate_normal(
        mean=post_means,
        cov=np.diag(post_vars),
        size=N_SAMPLES,
    )

    if inverse:
        best_mask = y == y.min(axis=1, keepdims=True)
    else:
        best_mask = y == y.max(axis=1, keepdims=True)
    best_arm_probs = best_mask.mean(axis=0)

    weights = _top_two_weights(y, inverse) if top_two else best_arm_probs.copy()
    weights = np.maximum(weights, MIN_ARM_WEIGHT)
    weights /= weights.sum()

    return {
        "enough_units": True,
        "update_message": "successfully updated",
        "best_arm_probabilities": dict(zip(arm_names, best_arm_probs.tolist())),
        "bandit_weights": dict(zip(arm_names, weights.tolist())),
        "seed": used_seed,
    }


def main(project_id: str, slug: str) -> None:
    experiment = get_experiment(project_id, slug)

    raw_input = experiment.get("inputData")
    if not raw_input:
        print("ERROR: inputData is empty in the experiment record.")
        sys.exit(1)

    raw = json.loads(raw_input) if isinstance(raw_input, str) else raw_input
    metrics_data = raw.get("metrics", raw)

    control, treatments = extract_variants(experiment)
    prior = extract_prior(experiment)
    primary_event = experiment.get("primaryMetricEvent") or ""
    all_arms = [control] + treatments

    if not primary_event or primary_event not in metrics_data:
        print(f"ERROR: primaryMetricEvent '{primary_event}' not found in inputData")
        sys.exit(1)

    pm = metrics_data[primary_event]
    inverse = bool(pm.get("inverse", False))

    arm_stats: list[tuple[float, float, int]] = []
    arms_summary = []
    for arm in all_arms:
        vdata = pm.get(arm, {})
        if not isinstance(vdata, dict) or not vdata:
            print(f"ERROR: no data for arm '{arm}' in metric '{primary_event}'")
            sys.exit(1)
        mean, var, n = metric_moments(vdata)
        arm_stats.append((mean, var, n))
        arms_summary.append(
            {
                "arm": arm,
                "n": n,
                "conversions": int(vdata.get("k", 0)),
                "rate": (float(vdata.get("k", 0)) / n) if n > 0 and "k" in vdata else mean,
            }
        )

    observed_n = [n for _, _, n in arm_stats]
    srm_p = srm_check(observed_n)

    result = compute_bandit_weights(
        arm_names=all_arms,
        arm_stats=arm_stats,
        prior=prior,
        inverse=inverse,
        top_two=True,
    )

    best_probs = result.get("best_arm_probabilities") or {}
    weights = result.get("bandit_weights") or {}

    sorted_best = sorted(best_probs.items(), key=lambda x: x[1], reverse=True)
    best_arm = sorted_best[0][0] if sorted_best else all_arms[0]
    best_p = float(sorted_best[0][1]) if sorted_best else 0.0
    threshold = 0.95

    output = {
        "type": "bandit",
        "experiment": slug,
        "computed_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "window": {
            "start": experiment.get("observationStart") or "",
            "end": experiment.get("observationEnd") or "",
        },
        "metric": primary_event,
        "algorithm": "thompson_sampling_top_two",
        "srm": {
            "chi2_p_value": round(srm_p, 4),
            "ok": srm_p >= 0.01,
            "observed": {arm: n for arm, n in zip(all_arms, observed_n)},
        },
        "arms": arms_summary,
        "thompson_sampling": {
            "results": [
                {
                    "arm": arm,
                    "p_best": float(best_probs.get(arm, 0.0)),
                    "recommended_weight": float(weights.get(arm, 0.0)),
                }
                for arm in all_arms
            ],
            "enough_units": result["enough_units"],
            "update_message": result["update_message"],
            "seed": result["seed"],
        },
        "stopping": {
            "met": bool(result["enough_units"] and best_p >= threshold),
            "best_arm": best_arm,
            "p_best": best_p,
            "threshold": threshold,
            "message": (
                f"{best_arm} reached P(best)={best_p:.4f} >= {threshold:.2f}"
                if result["enough_units"] and best_p >= threshold
                else (
                    result["update_message"]
                    if not result["enough_units"]
                    else f"best arm {best_arm} currently at P(best)={best_p:.4f}, threshold={threshold:.2f}"
                )
            ),
        },
    }

    upsert_experiment(project_id, slug, {
        "analysisResult": json.dumps(output),
        "status": "analyzing",
    })
    print(f"Written analysisResult to DB for experiment: {slug}")


if __name__ == "__main__":
    if len(sys.argv) != 3:
        print("Usage: python analyze-bandit.py <project-id> <experiment-slug>")
        sys.exit(1)
    main(sys.argv[1], sys.argv[2])
