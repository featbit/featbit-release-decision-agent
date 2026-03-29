# Bayesian A/B Analysis — Learning Tutorial

> This tutorial walks through the Bayesian A/B testing logic implemented in `analyze-bayesian.py` and documented in `references/analysis-bayesian.md` inside `experiment-workspace`.
> It records real questions and answers from the learning session, serving as ongoing context for continued study.

---

## Chapter 1: Why Bayesian?

Traditional A/B testing (frequentist) asks a counterfactual question:

> "Assuming treatment has **no effect**, how probable is it that I would observe this data?"

That is the p-value. It answers an indirect question and is not intuitive to act on.

Bayesian directly answers:

> "Given the data I collected, how probable is it that treatment is **truly better**?"

The output is `P(win) = 94%`, meaning: based on the current data, there is a 94% probability that treatment is genuinely better. This can be acted on directly.

---

## Chapter 2: Two Metric Types

### How to decide

Look at the shape of your raw data:

| Question | Metric type | Examples |
|----------|-------------|---------|
| Each user either did it or didn't | Proportion metric | Clicked or not, signed up or not, purchased or not |
| Each user has a concrete numeric value | Continuous metric | Revenue spent, session duration, articles read |

### Input data format

```json
// Proportion metric: only n and k
"cta_clicked": {
  "control":   {"n": 5000, "k": 300},
  "treatment": {"n": 5050, "k": 350}
}

// Continuous metric: n, sum, and sum_squares
"revenue_per_user": {
  "control":   {"n": 5000, "sum": 45000.0,  "sum_squares": 820000.0},
  "treatment": {"n": 5050, "sum": 48020.0,  "sum_squares": 901000.0}
}
```

### What is sum_squares?

`sum_squares` is the sum of each user's value **squared individually, then added together**:

```
sum_squares = x₁² + x₂² + x₃² + ... + xₙ²
```

This is **not** `(x₁ + x₂ + ... + xₙ)²` — it is not the square of the sum.

**Why is it needed?** Because the variance formula is:

```
var = (sum_squares - sum²/n) / (n - 1)
```

You cannot derive variance from `sum` alone — `sum_squares` is required. In practice, data lives in a database and you aggregate it with a single query:

```sql
SELECT
  COUNT(*)            AS n,
  SUM(value)          AS sum,
  SUM(value * value)  AS sum_squares
FROM events
WHERE variant = 'control'
```

Three numbers from one SQL query. The script derives both mean and variance from these.

### Edge case: inverse metrics

For metrics where lower is better (error rate, latency), add `"inverse": true`. P(win) then means "probability that treatment has a lower value."

---

## Chapter 3: Every Variable — Definition and Calculation

### 3.1 Proportion metric example

**Scenario:** Testing whether a new CTA button improves click-through rate.

**Raw data:**

| Variant | Exposed (n) | Converted (k) |
|---------|-------------|---------------|
| control | 5000 | 300 |
| treatment | 5050 | 350 |

**mean = conversion rate:**

```
mean_a = 300 / 5000 = 0.06     (6.00%)
mean_b = 350 / 5050 = 0.06931  (6.93%)
```

**var = dispersion of individual user behaviour:**

For proportion metrics each user is 0 or 1, so variance is determined by the mean itself:

```
var_a = 0.06 × (1 - 0.06)      = 0.0564
var_b = 0.06931 × (1 - 0.06931) = 0.06450
```

The closer the mean is to 0.5, the larger the variance (maximum uncertainty). The closer to 0 or 1, the smaller the variance.

**μ_rel = observed relative effect (point estimate):**

```
μ_rel = (mean_b - mean_a) / mean_a
      = (0.06931 - 0.06) / 0.06
      = +15.52%
```

**se = how uncertain we are about μ_rel:**

Computed via the Delta Method:

```
se = sqrt(
    var_b / (n_b × mean_a²)
  + var_a × mean_b² / (n_a × mean_a⁴)
)
≈ 8.79%
```

Larger se = smaller sample or higher variance = less reliable estimate.
The denominator contains `mean_a²`, so the lower the baseline conversion rate, the larger the se — low-conversion experiments are inherently more uncertain.

---

### 3.2 Continuous metric example

**Scenario:** Testing whether a new checkout flow increases revenue per user.

**Raw data:**

| Variant | n | sum | sum_squares |
|---------|---|-----|-------------|
| control | 5000 | 45000.0 | 820000.0 |
| treatment | 5050 | 48020.0 | 901000.0 |

**Calculation:**

```
# control
mean_a = 45000 / 5000 = 9.0 ($/user)
var_a  = (820000 - 45000²/5000) / (5000-1)
       = (820000 - 810000) / 4999
       ≈ 2.0004

# treatment
mean_b = 48020 / 5050 ≈ 9.509 ($/user)
var_b  = (901000 - 48020²/5050) / (5050-1)
       ≈ 88.01
```

Note: continuous metric variance tends to be much larger than proportion metric variance (users vary widely in revenue). However, with a large enough n, se can still be small.

```
μ_rel = (9.509 - 9.0) / 9.0 = +5.65%
se    ≈ 1.64%

P(win) = norm.sf(0, 0.0565, 0.01637) ≈ 99.97%
```

---

## Chapter 4: The Posterior Distribution N(μ_rel, se²)

### What is N?

`N` is the **Normal distribution (Gaussian distribution)**. The notation `N(μ, σ²)` means:

- `μ` = mean (the most likely value)
- `σ²` = variance; `σ = se` = standard deviation (the degree of uncertainty)

Note: the second parameter of `N(μ, σ²)` is the variance (σ²), not the standard deviation (σ). The code works with `se` (i.e. σ) because standard deviation shares the same unit as the data and is more intuitive to reason about.

### Why a distribution, not a single number?

Because you **do not know the true value of δ** — you can only say it is probably somewhere in a range.

Analogy: a friend says "I'll arrive around 3pm, give or take half an hour." They are not giving you a precise time — they are giving you an estimate with uncertainty attached. A normal distribution is the mathematical expression of exactly that:

```
μ = most likely value (3pm)
σ = degree of uncertainty (half an hour)
```

In A/B testing, the observed δ = +15.52% is just one sample. If you ran the experiment again, the data would differ slightly and δ would be slightly different. The normal distribution describes: **how probable is it that the true δ falls at each possible value?**

### Why can we use the normal distribution as an approximation?

This comes from the **Central Limit Theorem (CLT)**:

> When the sample size is large enough, the distribution of the sample mean approaches a normal distribution — regardless of the shape of the original data.

This is why the script requires at least **30 conversions per variant** — below that, the CLT has not yet kicked in, the normal approximation is unreliable, and P(win) and risk values may be misleading.

---

## Chapter 5: How P(win) Is Computed

### Intuition

`P(win) = probability that δ > 0 = area under the posterior curve to the right of 0`

```
         ▲
         │         ┌───┐
         │       ┌─┘███└─┐
         │      ─┘███████└─
         │   ───████████████───
         └─────┬───────────────▶ δ (relative lift)
               0   +μ_rel
         ←────→←──────────────→
        P(ctrl wins)  P(win)
```

Because the mean +15.52% sits well to the right of 0, the area to the right (P(win)) is large.

### Code

```python
ctw = norm.sf(0.0, loc=μ_rel, scale=se)
```

`sf` = survival function = `1 - CDF`, i.e. **the probability of being greater than a given value**:

```
norm.sf(0, loc=0.1552, scale=0.0879)
= P(δ > 0) where δ ~ N(0.1552, 0.0879²)
= P(treatment's true lift > 0)
= P(win)
≈ 96.1%
```

The mean is about 1.76 standard deviations above 0 (0.1552 / 0.0879), which is why the probability is high.

---

## Chapter 6: How This Relates to Bayes

A common source of confusion: the calculations above all look like frequentist tools (mean, variance, standard error). Where does Bayes come in?

**Bayes' theorem:**

```
posterior ∝ prior × likelihood
```

**Default mode (flat prior, `proper: false`):**

The prior is "flat" — it treats all possible values of δ equally with no preference. Therefore:

```
posterior ∝ 1 × likelihood = likelihood
```

The posterior equals the data likelihood. `N(μ_rel, se²)` is a Gaussian approximation of that likelihood — when the sample is large enough (CLT), the likelihood surface is approximately normal.

The full computation pipeline is:

```
Observed data
  → compute point estimate μ_rel and uncertainty se    (frequentist tools)
  → approximate posterior as N(μ_rel, se²)             (Bayesian framework)
  → derive P(win), CI, risk from the posterior          (Bayesian outputs)
```

**The value of Bayes is the framing, not the computation method.** It allows you to say "P(win) = 96%" — a direct probability statement. In frequentist testing you cannot say "there is a 96% probability treatment is better"; you can only say "p < 0.05, reject the null hypothesis."

**When you enable `proper: true`, Bayes genuinely enters the computation:**

```
post_mean = (data_mean/data_var + prior_mean/prior_var)
          / (1/data_var + 1/prior_var)
post_std  = sqrt(1 / (1/data_var + 1/prior_var))
```

The prior pulls the posterior mean toward historical knowledge. With small samples the prior dominates; with large samples the data overwhelms the prior — something a purely frequentist approach cannot do.

---

## Learning Progress

- [x] Chapter 1: Why Bayesian?
- [x] Chapter 2: Two metric types (proportion / continuous / inverse)
- [x] Chapter 3: Every variable — definition and calculation (mean, var, μ_rel, se)
- [x] Chapter 4: The posterior distribution N(μ_rel, se²)
- [x] Chapter 5: How P(win) is computed
- [x] Chapter 6: How this relates to Bayes
- [ ] Chapter 7: 95% Credible Interval
- [ ] Chapter 8: Risk (expected loss)
- [ ] Chapter 9: SRM check
- [ ] Chapter 10: Using an informative prior
