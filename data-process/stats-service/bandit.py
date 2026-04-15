"""
Thompson Sampling bandit weight computation — pure module (no CLI, no DB calls).

Core logic adapted from skills/experiment-workspace/scripts/analyze-bandit.py.
"""

from datetime import datetime, timezone

import numpy as np

from stats_utils import GaussianPrior, metric_moments, srm_check

MIN_UNITS_PER_ARM = 100    # burn-in guard
MIN_ARM_WEIGHT    = 0.01   # floor: no arm drops below 1%
N_SAMPLES         = 10_000


def _arm_posterior(
    mean: float, var: float, n: int, prior: GaussianPrior
) -> tuple[float, float]:
    if n == 0 or var == 0:
        return prior.mean, prior.variance
    data_var = var / n
    if not prior.proper:
        return mean, data_var
    data_prec  = 1.0 / data_var
    prior_prec = 1.0 / prior.variance
    post_prec  = data_prec + prior_prec
    post_mean  = (mean * data_prec + prior.mean * prior_prec) / post_prec
    return post_mean, 1.0 / post_prec


def _top_two_weights(y: np.ndarray, inverse: bool = False) -> np.ndarray:
    n_arms = y.shape[1]
    counts = np.zeros(n_arms)
    sorted_idx = np.argsort(y, axis=1)
    top1 = sorted_idx[:, 0]  if inverse else sorted_idx[:, -1]
    top2 = sorted_idx[:, 1]  if inverse else sorted_idx[:, -2]
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
    """
    Compute Thompson Sampling traffic weights for all arms.

    arm_stats: list of (mean, variance, n) per arm, in the same order as arm_names.

    Returns dict with: enough_units, update_message, best_arm_probabilities,
                       bandit_weights, seed.
    """
    counts = [n for _, _, n in arm_stats]

    if any(n < MIN_UNITS_PER_ARM for n in counts):
        return {
            "enough_units":           False,
            "update_message":         (
                f"burn-in: need ≥ {MIN_UNITS_PER_ARM} users per arm before dynamic weighting "
                f"(current minimum: {min(counts)})"
            ),
            "best_arm_probabilities": None,
            "bandit_weights":         None,
            "seed":                   None,
        }

    post_means, post_vars = [], []
    for mean, var, n in arm_stats:
        pm, pv = _arm_posterior(mean, var, n, prior)
        post_means.append(pm)
        post_vars.append(pv)

    rng       = np.random.default_rng(seed)
    used_seed = int(rng.integers(0, 1_000_000)) if seed is None else seed
    rng       = np.random.default_rng(used_seed)

    y = rng.multivariate_normal(
        mean=post_means,
        cov=np.diag(post_vars),
        size=N_SAMPLES,
    )

    best_mask     = y == (y.min(axis=1, keepdims=True) if inverse else y.max(axis=1, keepdims=True))
    best_arm_probs = best_mask.mean(axis=0)

    weights = _top_two_weights(y, inverse) if top_two else best_arm_probs.copy()
    weights = np.maximum(weights, MIN_ARM_WEIGHT)
    weights /= weights.sum()

    return {
        "enough_units":           True,
        "update_message":         "successfully updated",
        "best_arm_probabilities": dict(zip(arm_names, best_arm_probs.tolist())),
        "bandit_weights":         dict(zip(arm_names, weights.tolist())),
        "seed":                   used_seed,
    }


def compute_bandit_result(
    metrics_data: dict,
    all_arms: list[str],
    prior: GaussianPrior,
    primary_event: str,
    run_id: str = "",
) -> dict:
    """
    Convenience wrapper: aggregate per-arm stats from metrics_data and compute weights.
    Returns a full result dict suitable for saving as analysisResult.
    """
    pm = metrics_data.get(primary_event, {})
    inverse = bool(pm.get("inverse", False))

    arm_stats: list[tuple[float, float, int]] = []
    for arm in all_arms:
        vdata = pm.get(arm, {})
        mean, var, n = metric_moments(vdata) if vdata else (0.0, 0.0, 0)
        arm_stats.append((mean, var, n))

    srm_ns = [n for _, _, n in arm_stats]
    srm_p  = srm_check(srm_ns) if sum(srm_ns) > 0 else 1.0

    weights = compute_bandit_weights(all_arms, arm_stats, prior, inverse=inverse)

    return {
        "type":        "bandit",
        "run_id":      run_id,
        "computed_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "metric":      primary_event,
        "srm_p_value": round(srm_p, 4),
        **weights,
    }
