# Analysis Script

A single Python script that reads `input.json` from an experiment folder and writes `analysis.md`.

No dashboard required. No online account. Runs locally.

---

## Requirements

```
python >= 3.10
numpy
scipy
```

Install once:

```bash
pip install numpy scipy
```

---

## Script

The full script lives at [scripts/analyze-bayesian.py](../scripts/analyze-bayesian.py).

On first project setup, the agent copies it to `.featbit-release-decision/scripts/analyze-bayesian.py`. Run once per experiment:

```bash
python .featbit-release-decision/scripts/analyze-bayesian.py chat-cta-v2
```

---

## What the Script Does

1. Reads `definition.md` to know which flag variants, events, and prior to use
2. Loads `input.json` — aggregated per-variant metric data
3. For each metric, per treatment arm:
   - **Bayesian analysis** — analytical Gaussian posterior with optional informative prior, producing:
     - P(win): probability that treatment is better than control
     - 95% credible interval for the relative effect (posterior-adjusted when prior is proper)
     - Risk / expected loss: quantifies the downside of a wrong decision
   - **Frequentist Welch t-test** — p-value and confidence interval (independent of Bayesian output)
   - Optionally **sequential / always-valid** CI and e-value p-value for experiments where you peek before the fixed horizon (set `sequential: true` per metric in `input.json`)
4. **SRM check** — chi-squared test flags trafficking imbalances before you interpret any results
5. Checks sample size against `minimum_sample_per_variant`
6. Writes `analysis.md`

---

## Input Formats

### Proportion metric (conversion rate, click-through rate, …)

```json
"click_cta": {
  "control":   {"n": 5000, "k": 300},
  "treatment": {"n": 5050, "k": 350}
}
```

### Continuous metric (revenue, session duration, score, …)

```json
"revenue_per_user": {
  "control":   {"n": 5000, "sum": 45000.0,  "sum_squares": 820000.0},
  "treatment": {"n": 5050, "sum": 48020.0,  "sum_squares": 901000.0}
}
```

### Inverse metric (lower is better: error rate, latency, …)

Add `"inverse": true` at the metric level:

```json
"error_rate": {
  "inverse":   true,
  "control":   {"n": 5000, "k": 90},
  "treatment": {"n": 5050, "k": 70}
}
```

### Multiple treatment arms

Add more variant keys matching what is declared in `definition.md`:

```json
"click_cta": {
  "control":     {"n": 3300, "k": 198},
  "treatment_a": {"n": 3350, "k": 228},
  "treatment_b": {"n": 3300, "k": 215}
}
```

---

## Output Columns

| Column | Description |
|--------|-------------|
| `n` | Users / observations in this variant |
| `conv` / `mean` | Conversions (proportion) or mean value (continuous) |
| `rate` | Conversion rate (proportion metrics only) |
| `rel Δ` | Relative change vs control: (trt − ctrl) / ctrl |
| `95% credible CI` | Bayesian 95 % credible interval for the relative effect |
| `P(win)` | P(treatment is better), accounting for inverse flag |
| `risk[ctrl]` | Opportunity cost of *keeping* control if treatment is actually better |
| `risk[trt]` | Downside of *adopting* treatment if control is actually better |
| `p-value` | Frequentist Welch t-test p-value (two-sided) |
| `sig` | ✓ if p < 0.05, ✗ otherwise |

`risk[ctrl]` and `risk[trt]` are in the same unit as the relative effect (e.g. 0.003 = 0.3 % of control mean).  When evaluating whether to ship:
- a low `risk[trt]` means you lose little by adopting treatment even if control turns out to be better.
- a low `risk[ctrl]` means you lose little by staying on control even if treatment turns out to be better.

---

## Interpreting Results

### Quick decision guide

| P(win) | Interpretation |
|--------|----------------|
| ≥ 95 % | Strong signal — consider adopting treatment |
| 80 – 95 % | Leaning treatment — extend window or accept with risk awareness |
| 20 – 80 % | Inconclusive — extend window |
| 5 – 20 % | Leaning control |
| ≤ 5 % | Treatment is likely harmful |

Both P(win) and p-value are shown. They typically agree; divergence at the boundary can happen because the Bayesian posterior is Gaussian (flat prior) while the t-test uses Student-t. Trust the p-value for formal significance; trust P(win) + risk for decision framing.

### SRM (Sample Ratio Mismatch)

A χ² p-value < 0.01 is a red flag: the split may be corrupted by redirects, caching, bot traffic, or assignment bugs. Do not draw conclusions from such data until the root cause is fixed.

---

---

## Gaussian Prior (Optional)

The script supports an optional **informative Gaussian prior** on the relative effect, controlled by the `prior:` block in `definition.md`.

### Default behaviour (flat prior)

```markdown
prior:
  proper:  false
```

Posterior = data only. Identical to the original behaviour. Safe default — use this when you have no prior knowledge.

### Informative prior

```markdown
prior:
  proper:  true
  mean:    0.0    # no expected direction
  stddev:  0.3    # ±30% is the plausible lift range
```

The posterior is the **precision-weighted average** of the prior and the data:

```
post_mean = (data_mean/data_var + prior_mean/prior_var) / (1/data_var + 1/prior_var)
post_std  = sqrt(1 / (1/data_var + 1/prior_var))
```

**Effect on results:**

| Sample size | Prior influence |
|---|---|
| Small (n < 200) | Strong — result pulled toward `mean` |
| Medium | Partial shrinkage toward prior |
| Large | Data dominates, prior is washed out |

**When to use a proper prior:**
- You have historical data from similar experiments (set `mean` to the typical observed lift)
- You want to regularise noisy early results and reduce false positives in small samples
- You are running many experiments and want consistent shrinkage (set `stddev` to the typical lift range in your product)

**When to keep flat prior:**
- No prior experiments to draw from
- You want results to be purely data-driven with no subjective input
- Explaining results to stakeholders who expect standard frequentist-style output

The `prior:` line in `analysis.md` header tells you which mode was used: `flat/improper (data-only)` or `proper (mean=X, stddev=Y)`.

---

## Re-running After New Data

Both scripts are idempotent — re-run whenever you want fresh numbers.

```bash
# After pulling fresh counts:
python .featbit-release-decision/scripts/collect-input.py chat-cta-v2
python .featbit-release-decision/scripts/analyze-bayesian.py chat-cta-v2
```

`input.json` and `analysis.md` will both be overwritten with fresh numbers.
