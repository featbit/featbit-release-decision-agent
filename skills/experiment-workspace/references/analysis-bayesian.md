# Bayesian Analysis — How It Works and How to Use It

The analysis script reads `input.json` from an experiment folder and writes `analysis.md`.
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

## What the Script Does

1. Reads `definition.md` — variant names, metric events, observation window, optional prior
2. Loads `input.json` — aggregated per-variant counts
3. For each metric and each treatment arm:
   - Computes the **Bayesian posterior** over the relative effect δ = (mean_trt − mean_ctrl) / mean_ctrl
   - Derives **P(win)**, **95% credible interval**, and **risk / expected loss**
4. Runs an **SRM check** — flags trafficking imbalances before you interpret any result
5. Checks sample size against `minimum_sample_per_variant`
6. Writes `analysis.md`

---

## Conceptual Overview — What Bayesian A/B Testing Means

If you are new to Bayesian experimentation, here is the mental model the script uses.

### The question being answered

> "Given the data I collected, how probable is it that treatment is better than control?"

This is different from asking "is this result statistically significant?". The Bayesian approach gives you a **direct probability statement** about which variant is better, which is easier to act on.

### What the posterior distribution is

After observing `n` users and `k` conversions, the script constructs a **Gaussian posterior** over the relative effect δ:

```
δ = (mean_treatment − mean_control) / mean_control

posterior ~ N(μ_rel, se²)

where:
  μ_rel  = δ computed from your data (the point estimate)
  se     = standard error from the delta method (how uncertain we are)
```

The wider the posterior (larger `se`), the more uncertain the estimate — typically because sample sizes are small.

### The three outputs and how to read them

| Output | What it means |
|--------|---------------|
| **P(win)** | Posterior probability that treatment is better. 97% means "given what we observed, there is a 97% chance treatment is truly better." |
| **95% credible CI** | The relative lift is very likely somewhere in this range. `[+5%, +22%]` means you can say: "the true lift is probably between 5% and 22%." |
| **risk[ctrl]** | If you *stay on control* and treatment is actually better — your expected opportunity cost (as a fraction of the control mean). Lower is better when you want to hold. |
| **risk[trt]** | If you *adopt treatment* and control is actually better — your expected loss (as a fraction of the control mean). Lower is better when you want to ship. |

Risk is the most actionable output for decisions near the boundary. If `risk[trt] = 0.002`, shipping the wrong variant costs at most 0.2% — the downside is small even if you are wrong.

**The formula behind risk** (so you understand what the number represents):

```
risk_ctrl = E[max(0,  δ)]  =  ∫₀^∞  δ · p(δ) dδ
risk_trt  = E[max(0, -δ)]  =  ∫_{-∞}^0  |δ| · p(δ) dδ
```

Where `p(δ)` is the posterior distribution of the relative effect. In plain language:
- `risk_ctrl` = the average upside you leave on the table if treatment is better and you keep control
- `risk_trt` = the average downside you absorb if control is better and you ship treatment

Both are weighted by how probable each direction is — so a large absolute difference matters less if the posterior says that direction is very unlikely.

**Practical reference ranges for risk[trt]:**

| risk[trt] value | Interpretation |
|----------------|----------------|
| < 0.001 | Downside < 0.1% of control mean — negligible, safe to ship |
| 0.001 – 0.01 | Downside 0.1%–1% — acceptable for most product decisions |
| > 0.01 | Downside > 1% — meaningful; weigh against business context before shipping |

These ranges are heuristics, not hard rules. Calibrate against the business impact of a 1% error in your specific metric.

### Flat prior vs. informative prior

By default the script uses a **flat (improper) prior**: the posterior equals the data likelihood. This is the safest default — no assumptions injected.

If you set `proper: true` in `definition.md`, the script applies a **conjugate Gaussian prior update**:

```
post_mean = (data_mean/data_var + prior_mean/prior_var) / (1/data_var + 1/prior_var)
post_std  = sqrt(1 / (1/data_var + 1/prior_var))
```

With a small sample the posterior is pulled toward the prior mean. With a large sample the data dominates and the prior is washed out.

**Design note — why the prior is on δ, not on p:**

For proportion metrics, the textbook Bayesian approach puts a Beta prior directly on the conversion rate `p`:

```
p ~ Beta(α, β)  →  posterior: p | data ~ Beta(α+k, β+n-k)  (exact)
```

This script instead puts a Gaussian prior on the *relative effect* δ = (p_b − p_a) / p_a. This is a deliberate engineering trade-off:

- **Advantage:** the same code handles both proportion and continuous metrics with one unified interface
- **Advantage:** analytical (closed-form) solution — no MCMC sampling needed, runs instantly
- **Trade-off:** the Gaussian approximation is less accurate for small samples (n < 100 per variant) or extreme conversion rates (< 2% or > 98%)

With `proper: false` (the default), the flat prior means the posterior equals the likelihood — the script is using Bayesian language to describe what is mathematically equivalent to a likelihood-based estimate. The results are identical to what you would get from a normal approximation to the conversion rate difference. The Bayesian framing becomes meaningful when you use `proper: true` and inject real prior knowledge.

---

## Usage Patterns

### Pattern 1 — Basic proportion metric (conversion rate, click-through rate)

Input data: `n` users exposed, `k` who converted.

```json
"cta_clicked": {
  "control":   {"n": 5000, "k": 300},
  "treatment": {"n": 5050, "k": 350}
}
```

Run:

```bash
python .featbit-release-decision/scripts/analyze-bayesian.py <slug>
```

Output table includes: `n`, `conv`, `rate`, `rel Δ`, `95% credible CI`, `P(win)`, `risk[ctrl]`, `risk[trt]`.

---

### Pattern 2 — Continuous metric (revenue, session duration, score)

Input data: `n` observations, `sum` of values, `sum_squares` of values.

```json
"revenue_per_user": {
  "control":   {"n": 5000, "sum": 45000.0,  "sum_squares": 820000.0},
  "treatment": {"n": 5050, "sum": 48020.0,  "sum_squares": 901000.0}
}
```

The script computes `mean = sum / n` and `variance = (sum_squares − sum²/n) / (n−1)` internally.

Output table includes: `n`, `mean`, `rel Δ`, `95% credible CI`, `P(win)`, `risk[ctrl]`, `risk[trt]`.

---

### Pattern 3 — Inverse metric (lower is better: error rate, latency, p99)

Add `"inverse": true` at the metric level. P(win) is then P(treatment has a *lower* value).

```json
"error_rate": {
  "inverse":   true,
  "control":   {"n": 5000, "k": 90},
  "treatment": {"n": 5050, "k": 70}
}
```

Risk directions are also flipped: `risk[trt]` is the cost of adopting treatment if control's lower value is actually better.

---

### Pattern 4 — Multiple treatment arms (A/B/C test)

Add variant keys in `definition.md` and `input.json` matching each arm. The script runs a separate Bayesian comparison (each treatment vs. the single control) for every arm.

```json
"cta_clicked": {
  "control":     {"n": 3300, "k": 198},
  "treatment_a": {"n": 3350, "k": 228},
  "treatment_b": {"n": 3300, "k": 215}
}
```

Each treatment arm gets its own row in the output table and its own decision hint.

---

### Pattern 5 — Informative Gaussian prior

Use when you have historical data from similar experiments and want to regularise noisy early results.

In `definition.md`:

```markdown
prior:
  proper:  true
  mean:    0.0    # no expected direction (use historical lift if available)
  stddev:  0.3    # ±30% is the plausible lift range for this product area
```

Effect by sample size:

| Sample size | Prior influence |
|---|---|
| Small (n < 200) | Strong — result pulled toward `mean` |
| Medium | Partial shrinkage toward prior |
| Large (n > 1000) | Data dominates — prior washed out |

When to use:
- You have multiple past experiments in this area and know the typical lift range
- You want to reduce false positives on early peeks with small samples

When to keep flat (`proper: false`):
- First experiment in this area — no prior knowledge to encode
- You want results to be purely data-driven

The `analysis.md` header always states which mode was used: `flat/improper (data-only)` or `proper (mean=X, stddev=Y)`.

---

### Pattern 6 — Primary metric + guardrail metrics

`definition.md` supports one primary metric and multiple guardrails. The script runs Bayesian analysis on all of them.

```markdown
primary_metric_event:    cta_clicked
guardrail_events:
  - error_rate
  - page_load_time
```

In `analysis.md`, the primary metric section is labelled `### Primary Metric` and guardrail sections are labelled `### Guardrail`. Decision hints are only generated for the primary metric — guardrails are checked separately for harm signals.

---

## Output Columns Reference

| Column | Description |
|--------|-------------|
| `n` | Users / observations in this variant |
| `conv` | Conversions (proportion metrics only) |
| `rate` | Conversion rate (proportion metrics only) |
| `mean` | Mean value (continuous metrics only) |
| `rel Δ` | Relative change vs control: (trt − ctrl) / ctrl |
| `95% credible CI` | Bayesian 95% credible interval for the relative effect |
| `P(win)` | Posterior probability that this treatment is better than control |
| `risk[ctrl]` | Expected opportunity cost of keeping control (fraction of control mean) |
| `risk[trt]` | Expected loss from adopting treatment (fraction of control mean) |

---

## Decision Guide

Use P(win) and risk together to frame the decision for `evidence-analysis`:

| P(win) | risk[trt] | Interpretation |
|--------|-----------|----------------|
| ≥ 95% | low | Strong signal — adopt treatment |
| 80–95% | low | Leaning treatment — accept or extend window |
| 80–95% | high | Leaning treatment but downside risk is real — extend window |
| 20–80% | — | Inconclusive — extend observation window |
| ≤ 20% | — | Treatment is likely not better — lean control |
| ≤ 5% | — | Treatment appears harmful — consider stopping |

P(win) alone is the primary signal. `risk[trt]` tells you how costly the wrong choice is if P(win) is near a boundary.

### Multiple metrics and the guardrail intent

The script runs independent Bayesian analyses on each metric. There is no multiple-comparison correction across metrics. This is intentional, but it has an implication you need to understand:

**Guardrail metrics are for detecting harm, not for confirming lift.**

If you have 4 guardrail metrics, the probability that at least one of them shows a spuriously high P(win) just by chance is substantially higher than 20%. Do not celebrate a guardrail P(win) of 80% — it does not mean treatment improved that guardrail.

The correct reading of guardrail results:

| Guardrail P(win) | How to read it |
|-----------------|----------------|
| ≥ 80% | Likely a true lift on this guardrail — treat as a bonus, not a decision signal |
| 20%–80% | No detectable effect — guardrail is safe |
| ≤ 20% | Possible harm signal — investigate before shipping |
| ≤ 5% | Strong harm signal — do not ship until root cause is understood |

In short: use guardrails asymmetrically. A low P(win) on a guardrail is actionable. A high P(win) on a guardrail is noise unless it's your primary metric.

### Observation window

**Do not stop an experiment early because P(win) looks high.**

P(win) fluctuates during the observation window. An early peak at 95% can easily revert to 60% as more data arrives — especially in the first few days when user behaviour is atypical.

Minimum observation window rules:
- Run for **at least one full business cycle** — typically 7 days to capture weekly patterns (weekday vs weekend behaviour often differs significantly)
- For features that affect infrequent actions (e.g. checkout, onboarding), run until those actions have had a realistic chance to occur for most exposed users
- For high-traffic surfaces, even a short window accumulates sample fast — but still complete the full cycle for behaviour validity

**Novelty effect:** users often interact differently with a new UI element in the first 1–3 days simply because it is new. If your observation window is shorter than a week, early conversion lifts may not persist. When in doubt, extend the window to see if the signal stabilises.

A good signal is one that **holds steady** as more data arrives, not one that spikes and fades.

### SRM (Sample Ratio Mismatch)

A χ² p-value < 0.01 is a red flag: the traffic split is not what you configured. **Do not draw conclusions from the metric results until the root cause is fixed.**

Common causes to investigate in order:

1. **Redirect or page load asymmetry** — if one variant triggers a redirect that the other does not, users may drop out before being counted, creating an imbalance
2. **SDK initialisation timing** — flag evaluation happens before the SDK finishes loading for some users; they get a variant but are not logged as exposed
3. **Bot or crawler traffic** — automated traffic may be bucketed but behaves differently from real users; check if `n` values contain non-human spikes
4. **Assignment cache inconsistency** — a user is assigned to treatment on visit 1 but control on visit 2 (e.g. cookie cleared, logged out); double-counting inflates one variant
5. **Deployment timing** — treatment was rolled out gradually rather than all at once; the observation window start does not match when 100% of treatment users were active

Fix the root cause, reset the observation window, and collect fresh data. Do not adjust the data manually to compensate for SRM.

---

## Where This Fits in the Release Decision Flow

This script sits between data collection and the final decision:

```
measurement-design           ← defines the metric and instrumentation
    ↓
experiment-workspace         ← creates definition.md, collects input.json
    ↓
analyze-bayesian.py          ← YOU ARE HERE: produces analysis.md
    ↓
evidence-analysis            ← reads analysis.md, frames CONTINUE / PAUSE / ROLLBACK
    ↓
learning-capture             ← records what was learned
```

The agent runs this script as the "run the analysis" step inside `experiment-workspace`. After `analysis.md` is written, the agent hands off to `evidence-analysis` along with `definition.md` so the decision can be tied back to the original hypothesis.

---

## Re-running After New Data

Both scripts are idempotent — re-run whenever you want fresh numbers:

```bash
python .featbit-release-decision/scripts/collect-input.py <slug>
python .featbit-release-decision/scripts/analyze-bayesian.py <slug>
```

`input.json` and `analysis.md` are both overwritten with fresh numbers. The decision in `decision.md` is not overwritten — that is written by the agent after `evidence-analysis`.
