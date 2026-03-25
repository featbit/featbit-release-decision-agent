# Experiment Workspace — Backlog

Statistical / analysis features not yet implemented. Prioritize based on actual user need.

---

## 1. CUPED (Variance Reduction via Pre-experiment Covariate)

**What it is**: Use each user's pre-experiment metric value as a covariate to reduce variance,
which increases the effective power of the test without collecting more data.

**Why useful**: Can reduce the required sample size by 20–50 % for metrics with high user-level variance (e.g. revenue).

**What's needed**:
- `collect-input.py` must expose a second time window (pre-experiment) per variant per metric
- Input format extension: `{"n": N, "sum": S, "sum_squares": SS, "covariate_sum": CS, "covariate_sum_squares": CSS, "covariate_cross": CX}`
- `analyze-bayesian.py`: add `regression_adjusted_variance()` that computes the CUPED-corrected mean and variance before passing to `bayesian_result()` / `frequentist_result()`

**Complexity**: Medium — math is straightforward; the main work is extending the data pipeline.

---

## 2. Ratio Metrics (Denominator ≠ User Count)

**What it is**: Metrics where the denominator is an event count rather than a user count.
Example: "revenue per session" (not "revenue per user"), "errors per request".

**Why useful**: More natural for some product areas; avoids user-level averaging artifacts.

**What's needed**:
- Input format extension: per-variant `{"num_sum": N_S, "num_sum_squares": N_SS, "den_sum": D_S, "den_sum_squares": D_SS, "num_den_sum": ND_S}` (for the delta method)
- `analyze-bayesian.py`: add `ratio_moments()` that applies the delta method variance formula for ratios before handing off to existing analysis functions

**Complexity**: Medium — delta method formula is well-known; data collection side needs care.

---

## 3. Mid-experiment Power Analysis

**What it is**: Given current sample sizes and observed effect, estimate:
- Whether the current data is already conclusive
- How many more users / days are needed to reach the target power

**Why useful**: Helps decide "should we keep running?" without inflating Type-I error (unlike peeking at p-values).

**What's needed**:
- A separate `power-check.py` script (or a `--power` flag in `analyze-bayesian.py`)
- Inputs: current n, current effect estimate, target MDE, target power (default 0.8), target α (default 0.05)
- Outputs: estimated additional n needed, projected end date given daily traffic rate

**Complexity**: Low-medium — scaling factor formula is simple; UX design needs thought.

---

## 4. Bandits (Adaptive Traffic Allocation)

**What it is**: Instead of a fixed 50/50 split, dynamically reallocate traffic toward the
winning arm using Thompson Sampling (or Top-Two Thompson Sampling for exploration).

**Why useful**: Reduces regret during the experiment — fewer users are exposed to the losing variant.

**What's needed**:
- A separate `run-bandit.py` script (NOT part of offline analysis — this is a control-loop)
- Calls FeatBit API to read current rollout weights, reads live metric counts, computes new weights, writes updated weights back via FeatBit API
- Requires: FeatBit SDK / API access, real-time metric pipeline, scheduled execution (e.g. cron)
- Algorithm: Beta-Binomial Thompson Sampling for proportions; Gaussian Thompson Sampling for continuous

**Complexity**: High — needs live data pipeline + FeatBit API integration. Architecturally different from offline analysis.

**Note**: This should be a separate skill, not an extension of `experiment-workspace`.

---

## 5. Bayesian Prior (Informative)

**What it is**: Current implementation uses a flat (uninformative) prior. An informative prior
lets you encode historical baseline conversion rates so that results are sensible at very small
sample sizes.

**Why useful**: Early in an experiment, the flat prior can produce extreme P(win) values;
an informative prior stabilizes estimates.

**What's needed**:
- Optional `prior_mean` and `prior_variance` fields in `definition.md` or per-metric in `input.json`
- Small change in `bayesian_result()`: shift the posterior mean by the prior

**Complexity**: Low — one-line math change; mostly a design/configuration question.
