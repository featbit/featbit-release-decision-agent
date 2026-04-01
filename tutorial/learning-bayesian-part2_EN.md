# Bayesian A/B Testing — Advanced Tutorial (Part 2)

> Based on:
> - Book: Experimentation for Engineers
> - Our implementation:
>   - `skills/experiment-workspace/scripts/stats_utils.py` — shared statistical utilities
>   - `skills/experiment-workspace/scripts/analyze-bayesian.py` — Bayesian A/B analysis
>   - `skills/experiment-workspace/scripts/analyze-bandit.py` — Thompson Sampling weight computation

---

## Table of Contents

1. [Multi-Armed Bandits](#chapter-1-multi-armed-bandits)
2. Sequential Testing in the Bayesian Framework (coming soon)
3. Family-wise Error Correction (coming soon)
4. Holdout Groups (coming soon)

---

## Chapter 1: Multi-Armed Bandits

### 1.1 Intuition: Why Do We Need MAB?

Our current A/B test workflow fixes traffic at 50/50 and runs for the full experiment window. But this has a hidden cost:

> After 5 days, P(win) is already 88% — a strong signal, but not yet 95%. Every day from now on, you are still sending **50% of your traffic to the version you already believe is worse.**

The wasted revenue from routing users to suboptimal variants is called **Regret**.

MAB's goal: **dynamically shift traffic toward the better arm as evidence accumulates, while keeping enough exploration to avoid locking in a wrong decision.**

---

### 1.2 Where the Name Comes From: The Slot Machine Analogy

Imagine walking into a casino with 3 slot machines. Each has a different payout rate, but you don't know which is best:

```
Machine A: true win rate 30% (unknown to you)
Machine B: true win rate 15% (unknown to you)
Machine C: true win rate 45% (unknown to you)
```

You have 1000 pulls. Goal: maximize total winnings.

- Only pull one machine (pure exploit) → you might always pull the worst one
- Pull all three equally (pure explore) → you waste too many pulls on bad machines
- **Optimal: explore all, but shift more pulls toward whichever looks best**

This is the **Explore vs. Exploit trade-off**. The name: multi-armed = multiple machines, bandit = slot machine (one-armed bandit).

**In A/B testing terms:**

```
Each arm = one variant in the experiment (not a separate experiment)

arm_A = control   (grey button)
arm_B = treatment 1  (blue button)
arm_C = treatment 2  (red button)
```

---

### 1.3 Thompson Sampling: Core Mechanism

Thompson Sampling reduces to one operation:

> **Sample one value from each arm's posterior distribution. Whichever arm draws the highest value "wins" this round.**

**Concrete walkthrough (two arms):**

Current data:
```
arm_A (control):   n=3000, k=63  → conversion rate 2.1%
arm_B (treatment): n=3000, k=78  → conversion rate 2.6%
```

**Step 1: Build a posterior distribution for each arm (CLT approximation)**
```
arm_A posterior: N(μ=0.021, se²=0.021×0.979/3000)
arm_B posterior: N(μ=0.026, se²=0.026×0.974/3000)
```

**Step 2: Draw one random sample from each posterior**
```python
sample_A = np.random.normal(0.021, se_A)  # e.g. draws 0.023
sample_B = np.random.normal(0.026, se_B)  # e.g. draws 0.025
```

**Step 3: The arm with the higher sample "wins" this round**
```
sample_A=0.023 < sample_B=0.025  → arm_B wins this round
```

**Step 4: Repeat 10,000 times and count how often each arm wins**
```
arm_A wins: 1,800 times → 18%
arm_B wins: 8,200 times → 82%

→ Next traffic allocation: arm_A 18%, arm_B 82%
```

---

### 1.4 Why This Automatically Balances Exploration and Exploitation

The key is how posterior width changes with sample size:

```
Few samples → wide posterior (high uncertainty)
             → draws are noisy
             → all arms win sometimes
             → exploration is preserved naturally

Many samples → narrow posterior (high certainty)
              → the better arm draws a higher value almost every time
              → traffic concentrates on the best arm
              → exploitation happens naturally
```

**The explore/exploit balance is automatic — no tuning required.** This is what makes Thompson Sampling more elegant than Epsilon-Greedy.

---

### 1.5 On the Stopping Threshold: Why 95%?

**95% is a convention, not a mathematical law.** It was inherited from frequentist statistics (`alpha = 0.05`) because the industry was already familiar with it.

In the Bayesian framework, the threshold is a **business decision** that depends on the cost of each type of mistake:

| Error type | Meaning | Cost |
|-----------|---------|------|
| False positive (ship bad feature) | P(win) was high but treatment is actually worse | User harm, revenue loss |
| False negative (don't ship good feature) | P(win) was low but treatment is actually better | Missed opportunity |

**How to choose the threshold:**
- Hard to roll back after shipping → raise threshold (99%)
- Can instantly kill with a feature flag → lower threshold is fine (90%)
- Guardrail metrics (must not get worse) → check `P(harm) < 1%` — stricter than 95%

---

### 1.6 Two Key Engineering Details

Thompson Sampling requires two protection mechanisms in practice — both grounded in the book's theory.

**Detail 1: Burn-in period — require at least 100 users per arm before activating dynamic weights**

The book states explicitly (Chapter 3):

> "The bootstrap distribution converges to the normal distribution by the Central Limit Theorem for sample sizes above ~100 per variant."

With fewer than 100 users, the posterior is extremely wide and noise-dominated. P(best) computed from such data is nearly random. Using noisy early data to shift traffic weights introduces incorrect early skew — an arm that is simply having a bad run loses traffic it never deserved to lose.

**Conclusion: hold equal traffic allocation during burn-in; only activate dynamic weights once every arm has ≥ 100 users.**

**Detail 2: Minimum traffic floor — keep every arm at ≥ 1%**

The book's Chapter 3 (on explore/exploit) states:

> "Never allocate zero traffic to any arm. Early data is noisy — an arm that looks bad after 50 samples may be the true winner. Keeping a minimum exploration floor ensures you can always recover from early misreadings."

Chapter 8 (Optimism Bias) reinforces this: an arm that looks bad on small samples may simply be unlucky. Cutting it to zero traffic permanently forfeits the chance to correct that misreading.

**Conclusion: regardless of how low P(best) falls, every arm retains ≥ 1% of traffic.**

**Top-Two Strategy: concentrate exploration on real competitors**

Building on these two safeguards, traffic can be further refined: only let the top two arms compete for the majority of traffic, while all others hold the minimum floor.

```
Example with 3 arms:
arm_A: P(best) = 70%
arm_B: P(best) = 25%
arm_C: P(best) = 5%

Top-Two allocation:
arm_A: 70/(70+25) = 73.7%
arm_B: 25/(70+25) = 26.3%
arm_C: 1% (floor — never fully abandoned)
```

Why: keeps exploration focused on arms still in contention, rather than wasting traffic on one that is already clearly losing.

**Gap vs. our current implementation:**

| | Our A/B | Thompson Sampling MAB |
|--|---------|----------------------|
| Traffic split | Fixed 50/50 throughout | Re-weighted each round based on P(win) |
| During experiment | Traffic "wasted" on inferior arm | Traffic automatically shifts to better arm |
| Final estimate | δ (delta) estimate is more precise | Accumulated regret is lower |
| Best for | "How much did it improve?" | "Maximize revenue during the experiment" |

Our `P(win)` calculation (`norm.sf(0, μ_rel, se_rel)`) is the **analytical equivalent** of Thompson Sampling's 10,000-draw simulation — both give the same result at large sample sizes, ours is just faster.

What MAB needs on top: feed `P(win)` back to the **traffic allocation system** to dynamically update each variant's weight in FeatBit feature flags.

---

---

## Chapter 2: Sequential Testing in the Bayesian Framework

### 2.1 What Is the Peeking Problem?

Peeking means repeatedly checking statistical results during an experiment and stopping early the moment they "look good enough."

**Why it is severe in frequentist statistics:**

The p-value has an implicit assumption: you look at the result exactly once, at the end. If you check every day and stop as soon as `p < 0.05`, your actual false positive rate can reach 30%.

The book quantifies this directly (Chapter 8):

> "If you check results at every time step and stop as soon as P(win) > 95%, your actual false positive rate is not 5% — it can exceed 30% for long-running experiments."

The reason: p-value random-walks during the experiment and will momentarily dip below 0.05 before recovering. If you stop at that peak, you lock in a noise signal.

**Does the Bayesian framework have the same problem?**

Theoretically more forgiving, but still requires care:

- The Bayesian posterior is a **coherent, complete description of your beliefs given current data** at any point in time — this is called **posterior coherence**
- Theoretically, you can look at P(win) at any time without needing a correction
- But if you **stop the moment P(win) briefly exceeds 95%**, you are still making an implicit selection: you chose a moment when P(win) happened to spike due to noise, which inflates the δ (delta) estimate

This is called the **Optional Stopping Problem**. Bayesian statisticians debate its severity, but practical safeguards are still warranted.

---

### 2.2 Why We Do Not Implement Sequential Testing

This is a deliberate, principled design decision — not an oversight.

**Reason 1: The Bayesian framework theoretically does not need it**

Bayesian posteriors do not rely on a "look only once" assumption — the posterior is a valid description of current beliefs at any sample size. Sequential Testing addresses a problem that belongs to a different statistical framework, not ours.

**Reason 2: We already have sufficient practical safeguards**

| Safeguard | Purpose |
|-----------|---------|
| `minimum_sample_per_variant` | Burn-in: prevents analysis on noisy small-sample posteriors |
| `risk[trt]` | More robust stopping signal than P(win) alone |

`risk[trt]` is harder to trigger spuriously: it requires both the right direction **and** an acceptable expected loss — not just a probability crossing a threshold.

**Reason 3: Rigorous Bayesian sequential methods exist but add complexity beyond practical benefit**

Methods like Bayes Factors, ROPE+HDI, and Expected Loss Threshold (`risk[trt] < ε`) are mathematically valid Bayesian sequential approaches, but their interpretation and communication cost outweighs their benefit for typical product experimentation teams. Using `risk[trt]` as a second signal alongside P(win) covers the practical need.

---

### 2.3 What We Do Instead

**Safeguards already in place:**

**1. Burn-in guard** — configured in `definition.md`:
```yaml
minimum_sample_per_variant: 1000   # calculated from baseline conversion rate, not a fixed value
```
`analyze-bayesian.py` shows whether the current sample has reached this floor. Below it, P(win) and risk are still computed but should be treated as indicative, not actionable.

**2. Robust stopping signal** — use both P(win) and `risk[trt]`:

```
P(win) ≥ 95%  AND  risk[trt] small enough for the business context  →  then consider stopping
```

**Recommended operating discipline (documentation, no code change needed):**

1. **Fix the experiment horizon upfront** — do not stop early because results "look promising"
2. **Use both signals**: P(win) ≥ 95% **and** risk[trt] small enough for the business context
3. **If you must look mid-experiment**, raise the threshold (e.g. P(win) ≥ 98%) to compensate for the additional look

> **Book's practical recommendation (Chapter 8)**: Fixed-horizon testing — deciding the sample size upfront and looking exactly once — is the simplest and most reliable safeguard. "Don't look early, don't stop early" is easier to execute than any statistical correction. Our `minimum_sample_per_variant` is the engineering implementation of this discipline.

---

## Learning Progress

- [x] Chapter 1: Multi-Armed Bandits (1.1 ~ 1.6)
- [x] Chapter 2: Sequential Testing in the Bayesian Framework
- [ ] Chapter 3: Family-wise Error Correction
- [ ] Chapter 4: Holdout Groups
