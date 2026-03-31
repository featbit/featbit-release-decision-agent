# Bandit Analysis Reference

Thompson Sampling multi-armed bandit for dynamic traffic allocation.

Unlike Bayesian A/B testing (fixed 50/50 split, one-shot analysis), a bandit experiment is a **continuous feedback loop**: traffic weights are adjusted repeatedly as data accumulates, shifting more traffic toward the arm that is performing better.

---

## When to Use Bandit vs. A/B

| Goal | Method |
|------|--------|
| "Did this feature improve the metric? By how much?" | Bayesian A/B (`analyze-bayesian.py`) |
| "Which variant should get more traffic right now to maximize reward during the experiment?" | Bandit (`analyze-bandit.py`) |

Bandit is appropriate when:
- Minimizing regret during the experiment matters (e.g. revenue-critical features)
- You are comparing multiple variants (3+) and want to converge faster
- The experiment will run for a long time and you want to avoid "wasting" traffic

Bandit is **not** appropriate when:
- You need a precise δ (delta) estimate with a valid confidence interval — dynamic allocation biases the estimate
- The experiment is short (< a few days) — burn-in leaves too little time for reweighting
- You need a clean causal estimate (e.g. for pricing, regulatory reporting)

> **Book reference** — *Experimentation for Engineers*, Chapter 3: the book draws a clear distinction between A/B testing ("what is the effect?") and bandits ("which arm should get traffic now?"). It frames bandit as the right tool when cumulative reward during the experiment matters more than a precise post-hoc effect estimate.

---

## How It Works

Every time you run `analyze-bandit.py`:

1. Builds a Gaussian posterior for each arm from current data (same CLT approximation as `analyze-bayesian.py`)
2. Draws 10,000 samples from a multivariate normal across all arm posteriors
3. Computes `best_arm_probabilities`: how often each arm drew the highest value
4. Applies **Top-Two strategy**: only the top two arms compete for majority traffic; all others hold the minimum floor
5. Enforces a **1% minimum floor** on every arm — no arm is ever fully cut off

> **Book reference** — *Experimentation for Engineers*, Chapter 3: the book warns against allocating zero traffic to any arm. Early data is noisy; an arm that looks bad after 50 samples may be the true winner. The minimum floor ensures you can always recover from early misreadings. The Top-Two strategy is the book's recommended refinement for reducing regret while keeping exploration focused on real contenders.
6. Outputs recommended weights to `bandit-weights.json`

**Burn-in guard**: if any arm has fewer than 100 users, dynamic weighting does not activate. The script reports the shortfall and exits without writing weights. This prevents early noise from corrupting allocation decisions.

> **Book reference** — *Experimentation for Engineers*, Chapter 3: the book notes that the bootstrap posterior (and by extension the Gaussian CLT approximation) converges reliably only above ~100 samples per arm. Acting on weights computed from fewer samples introduces harmful early skew that can be hard to recover from.

---

## Running the Script

```bash
python .featbit-release-decision/scripts/analyze-bandit.py <slug>
```

Reads:
- `.featbit-release-decision/experiments/<slug>/definition.md`
- `.featbit-release-decision/experiments/<slug>/input.json`

Writes:
- `.featbit-release-decision/experiments/<slug>/bandit-weights.json`

Input format is identical to `analyze-bayesian.py` — proportion `{"n", "k"}` or continuous `{"n", "sum", "sum_squares"}`.

---

## Output: `bandit-weights.json`

```json
{
  "experiment":   "my-feature-v2",
  "computed_at":  "2026-04-01T08:00:00Z",
  "metric":       "signup_click",
  "srm_p_value":  0.42,
  "enough_units": true,
  "update_message": "successfully updated",
  "best_arm_probabilities": {
    "control":   0.12,
    "treatment": 0.88
  },
  "bandit_weights": {
    "control":   0.10,
    "treatment": 0.90
  },
  "seed": 482901
}
```

| Field | Meaning |
|-------|---------|
| `enough_units` | `false` during burn-in — do not apply weights yet |
| `update_message` | Human-readable status; explains why weights are null during burn-in |
| `best_arm_probabilities` | P(this arm is best) for each arm — the primary signal |
| `bandit_weights` | Recommended traffic fraction per arm after Top-Two + floor — use this to update FeatBit |
| `srm_p_value` | SRM check on current data; if < 0.01, investigate before applying weights |
| `seed` | Random seed used for reproducibility |

---

## Applying Weights to FeatBit

After reading `bandit-weights.json`, update the feature flag's variant rollout via the FeatBit API.

FeatBit uses cumulative range format for rollout: `[start, end]` where end − start = weight.

**Converting `bandit_weights` to FeatBit rollout ranges:**

```python
# Example: {"control": 0.10, "treatment": 0.90}
# → control:   rollout [0.00, 0.10]
# → treatment: rollout [0.10, 1.00]

cumulative = 0.0
for arm, weight in bandit_weights.items():
    rollout = [cumulative, cumulative + weight]
    cumulative += weight
```

**FeatBit API endpoint:**
```
PUT /api/v1/envs/{envId}/feature-flags/{flagKey}/targeting
```

Update the `fallthrough.variations[].rollout` field with the computed ranges.

This step requires FeatBit system integration. Full automation (scheduled reweighting without manual intervention) requires implementing a scheduler that calls `analyze-bandit.py` periodically and applies weights via the API.

> **Book reference** — *Experimentation for Engineers*, Chapter 3: the book describes the full Thompson Sampling feedback loop as a continuous "sample → estimate posterior → allocate → repeat" cycle. The scheduling interval (how often to reweight) is a tuning parameter: shorter intervals react faster but add noise; longer intervals are more stable but slower to adapt.

---

## Stopping Condition

Stop the bandit experiment when:

```
best_arm_probabilities[arm] >= 0.95
```

At this point:
- Set the winning arm to 100% traffic in FeatBit (or end the experiment)
- The dynamic reweighting loop is complete

> **Book reference** — *Experimentation for Engineers*, Chapter 3: the book uses `pbest(arm) ≥ 0.95` as the explicit stopping threshold for Thompson Sampling — the same value we use here. It is not a hard mathematical requirement but a practical convention: it means you are 95% confident this arm is the best, which is sufficient for most product decisions.

---

## Transition to Final Analysis

After stopping, run the standard Bayesian analysis on the full collected dataset:

```bash
python .featbit-release-decision/scripts/analyze-bayesian.py <slug>
```

**Important caveat**: bandit experiments produce unequal traffic splits (e.g. 90/10 by the end). This means:
- The δ (delta) estimate in `analysis.md` is valid but has wider uncertainty than a balanced 50/50 design
- `best_arm_probabilities` from the final `bandit-weights.json` is the most reliable decision signal
- Use both together when handing off to `evidence-analysis`

Hand off to `evidence-analysis` with:
- `analysis.md` (final Bayesian analysis)
- `bandit-weights.json` (final best_arm_probabilities)
- `definition.md`

---

## Recommended Cadence

| Phase | Action | Frequency |
|-------|--------|-----------|
| Burn-in | Collect data, do not reweight | Until every arm ≥ 100 users |
| Exploit | Run `analyze-bandit.py`, apply weights to FeatBit | Every 6–24 hours |
| Stopping | `best_arm_probabilities >= 0.95` | Check each cycle |
| Wrap-up | Run `analyze-bayesian.py`, hand off to `evidence-analysis` | Once, after stopping |
