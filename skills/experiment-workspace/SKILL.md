---
name: experiment-workspace
description: Creates and manages experiments as local files — the offline replacement for an online A/B test dashboard. Activate when user is ready to start collecting data for a hypothesis, wants to set up an experiment, needs to pull or organize experiment data, wants to run analysis calculations, or asks "how do I track this experiment", "set up the experiment", "run the analysis", "pull results", "compute the stats". Sits between measurement-design (instrumentation confirmed) and evidence-analysis (results interpreted). Do not use before a hypothesis and primary metric exist.
license: MIT
metadata:
  author: FeatBit
  version: "1.0.0"
  category: release-management
---

# Experiment Workspace

This skill manages the full experiment lifecycle as local files.

It replaces what an online experiment dashboard does — experiment creation, data collection tracking, analysis computation, and result storage — with a shared folder that any team member can read, commit to git, and reason about without a browser.

The folder is the experiment. The script is the dashboard.

---

## When to Activate

- Hypothesis exists, primary metric is defined, instrumentation is confirmed (came from `measurement-design`)
- User wants to "start the experiment" — create the tracking structure
- User wants to pull data and run analysis
- User wants to check whether enough data has accumulated
- User wants to archive a completed experiment result
- `.featbit-release-decision/intent.md` shows `stage: measuring`

Do not activate if:
- Hypothesis is not yet written → go to `hypothesis-design`
- Primary metric is undefined → go to `measurement-design`
- Data already exists and the user only wants a decision → go to `evidence-analysis` directly

---

## What This Skill Manages

```
.featbit-release-decision/
  intent.md                    ← current run state (CF-01 through CF-08)
  decision.md                  ← decision output (written by evidence-analysis)
  experiments/
    <experiment-slug>/
      definition.md            ← agent creates
      input.json               ← collect-input.py writes
      analysis.md              ← analyze-bayesian.py writes       [A/B]
      bandit-weights.json      ← analyze-bandit.py writes         [Bandit]
      decision.md              ← agent writes after evidence-analysis
    archive/                   ← completed experiments moved here
  scripts/
    stats_utils.py             ← shared statistical utilities (imported by analysis scripts)
    analyze-bayesian.py        ← Bayesian A/B analysis (complete, ready to run)
    analyze-bandit.py          ← Thompson Sampling weight computation (complete, ready to run)
    collect-input.py           ← data collector placeholder (implement fetch_metric_summary)
    check-sample.sh            ← quick sample count check
```

**Two experiment types:**
- **A/B (default)**: fixed 50/50 traffic split, one-shot analysis → `analyze-bayesian.py`
- **Bandit**: dynamic traffic reweighting via Thompson Sampling → `analyze-bandit.py` (requires FeatBit API integration for full automation)

All agent-managed files for a project live under `.featbit-release-decision/`. The folder can be committed to git. No credentials or personally identifiable data should be stored here — `user_key` values should be pseudonymous identifiers.

---

## Decision Actions

### "First time setup"

1. Check whether `.featbit-release-decision/scripts/` exists in the project
2. If not, copy all scripts from `scripts/` into `.featbit-release-decision/scripts/`:
   - `stats_utils.py` — shared utilities; must be present for both analysis scripts to run
   - `analyze-bayesian.py` — ready to run, no edits needed
   - `analyze-bandit.py` — ready to run, no edits needed
   - `collect-input.py` — placeholder; user must implement `fetch_metric_summary()`
   - `check-sample.sh` — ready to run once `input.json` exists
3. Tell the user: `collect-input.py` needs to be customized for their data source before it can be used. Both analysis scripts work out of the box once `input.json` exists. `stats_utils.py` must be in the same directory as the analysis scripts.

This setup is idempotent — safe to re-run if files are already present.

---

### "I want to start an experiment"

1. Confirm the hypothesis slug — derive from the flag key, e.g. `chat-cta-v2`
2. Run setup if not done: copy scripts from `scripts/` to `.featbit-release-decision/scripts/`
3. Create `.featbit-release-decision/experiments/<slug>/definition.md` from the template in `references/experiment-folder-spec.md`
4. Copy `hypothesis:` verbatim from `.featbit-release-decision/intent.md`
5. Confirm the `observation_window.start` date — this is today if the flag was just enabled
6. Set `minimum_sample_per_variant` using the following fallback chain. Do not expose the formula to the user at any step.

   **Step 1 — read the hypothesis in `intent.md`:**
   - Does it mention a current baseline rate? (e.g. "increase signup rate from 4% to 5%" → p_baseline = 0.04)
   - Does it mention an expected lift that implies a current level? Extract the number and compute `ceil(30 / p_baseline)`

   **Step 2 — infer from metric event name and funnel stage:**
   - Re-read the primary metric event name: does it suggest a funnel position?
   - Use these heuristics as a starting estimate:

     | Metric type | Typical baseline range | Suggested floor |
     |-------------|----------------------|-----------------|
     | Button click / CTA | 3–10% | 500 |
     | Signup / registration | 1–5% | 1,000 |
     | Purchase / checkout | 1–3% | 1,500 |
     | Feature engagement (active users) | 10–30% | 200 |
     | Error rate / latency (inverse) | 1–5% | 1,000 |

   **Step 3 — collect a short baseline sample from the control group (most accurate):**
   - If the flag has been live for at least 1–3 days, guide the user to pull control-only data for that period and share it with the agent.
   - Tell the user exactly what numbers are needed:
     > "To get an accurate baseline, I need two numbers from your control group for the past few days:
     > - **n** — how many unique users were exposed to the control variant
     > - **k** — how many of those users triggered the '[metric event]' event
     > You can get these from FeatBit's experiment results, your database, or your analytics tool."
   - Once the user provides `n` and `k`: compute `p_baseline = k / n`, then set `ceil(30 / p_baseline)` — this overrides any estimate from Steps 1–2

   **Step 4 — ask the user only if Steps 1–3 all fail:**
   "What is the current conversion rate for [metric name]? A rough estimate is fine, e.g. 'about 5%' or 'maybe 1 in 20 users'."

   **Step 5 — if no estimate is available from any source:**
   - Use 1,000 as a safe conservative default (assumes ~3% baseline)
   - Record the assumption explicitly in `definition.md` as a comment so it can be revised once real data arrives
7. Ask the user whether they have prior knowledge about the expected lift for this metric:
   - "Do you have results from a similar past experiment? If so, what was the approximate lift and how uncertain was it?"
   - If the user provides a past `μ_rel` and `se` (or a rough range): set `proper: true`, `mean: <μ_rel>`, `stddev: <se>` in `definition.md`
   - If the user ran a pilot phase (separate experiment window) and has its `analysis.md`: read `μ_rel` and `se` from it and use those as the prior — but only if the pilot data will **not** be included in the new experiment's `input.json`
   - If no prior knowledge is available: set `proper: false` (flat prior, the safe default) and note this in `definition.md`
8. Update `.featbit-release-decision/intent.md`: `stage: measuring`
9. Tell the user: the next step is to collect data (customize `collect-input.py` if needed), then run the analysis

The agent does not need to touch any online dashboard. Creating `definition.md` is the equivalent of "creating an experiment".

### "I want to check if we have enough data"

1. Check if `input.json` exists at `.featbit-release-decision/experiments/<slug>/input.json`
   - If not, data has not been collected yet — direct to `references/data-source-guide.md` or `collect-input.py`
2. If it exists, run the sample check:
   ```bash
   bash .featbit-release-decision/scripts/check-sample.sh <slug>
   ```
3. Compare the printed counts against `minimum_sample_per_variant` in `definition.md`
4. If below minimum: do not proceed to analysis — wait and re-check later
5. If above minimum: proceed to run the analysis

### "I want to run the analysis"

1. Confirm `input.json` is present at `.featbit-release-decision/experiments/<slug>/input.json`
2. If missing: run `collect-input.py` or follow `references/data-source-guide.md` to produce it
3. Run:
   ```bash
   python .featbit-release-decision/scripts/analyze-bayesian.py <slug>
   ```
4. Read the output in `.featbit-release-decision/experiments/<slug>/analysis.md`
5. Key outputs to check before handing off:
   - **P(win)** ≥ 95% → strong signal; ≤ 5% → likely harmful; 20–80% → inconclusive
   - **risk[trt]** — if P(win) is near a boundary, this tells you how costly a wrong call is
   - **SRM check** — if χ² p-value < 0.01, stop and investigate traffic split before interpreting metrics
6. Hand off to `evidence-analysis` with both `analysis.md` and `definition.md` as inputs

For the full list of metric types and usage patterns (proportion, continuous, inverse, multiple arms, informative prior), see `references/analysis-bayesian.md`.

**Multi-arm threshold reminder:** if the experiment has more than 2 variants (A/B/C/n), raise the P(win) threshold to compensate for multiple comparisons:

| Arms compared | Suggested threshold |
|--------------|-------------------|
| 2 | 95% |
| 3 | 98.3% |
| 5 | 99% |

See `references/analysis-bayesian.md` → "On Family-wise Error" for details.

### "I want to update the data and re-run"

1. Re-run `collect-input.py` to pull fresh counts — it overwrites `input.json`
2. Re-run:
   ```bash
   python .featbit-release-decision/scripts/analyze-bayesian.py <slug>
   ```
3. `analysis.md` is overwritten with fresh numbers — both scripts are idempotent

### "I want to run a Bandit experiment"

A bandit experiment replaces fixed 50/50 traffic with dynamic reweighting. It requires a continuous cycle of data collection → weight computation → FeatBit flag update.

**Setup** (same as A/B — `definition.md` format is identical):
1. Create `definition.md` following the standard template
2. Choose `primary_metric_event` — bandit optimizes this single metric
3. Note: bandit works best for proportion metrics (conversion rate, CTR)

**Each reweighting cycle** (recommended every 6–24 hours):
1. Collect fresh data → `input.json`
2. Run:
   ```bash
   python .featbit-release-decision/scripts/analyze-bandit.py <slug>
   ```
3. Read `bandit-weights.json`:
   - If `enough_units: false` → burn-in not complete, do not apply weights yet (need ≥ 100 users per arm)
   - If `srm_p_value < 0.01` → SRM detected, investigate traffic split before applying weights
   - Otherwise → apply `bandit_weights` to the FeatBit feature flag via API
4. Update FeatBit feature flag rollout weights using the FeatBit API (see `references/analysis-bandit.md` for the conversion formula)

**Stopping condition**: when `best_arm_probabilities[arm] >= 0.95` for any arm, stop reweighting.

**After stopping — transition to final analysis**:
1. Set winning arm to 100% in FeatBit
2. Run final Bayesian analysis on full dataset:
   ```bash
   python .featbit-release-decision/scripts/analyze-bayesian.py <slug>
   ```
3. Hand off to `evidence-analysis` with:
   - `analysis.md` (final Bayesian result — note: δ estimate may have wider uncertainty due to unequal traffic)
   - `bandit-weights.json` (final `best_arm_probabilities` — most reliable decision signal)
   - `definition.md`

For full details on output interpretation and FeatBit API integration, see `references/analysis-bandit.md`.

### "I want to track long-term effects after launch"

A/B and Bandit experiments measure short-term behavior. Transient effects — novelty, seasonal spikes, event-driven traffic — can inflate results during the experiment window. A holdout group validates whether the effect persists over months.

1. After full launch, adjust the feature flag traffic split to 95/5 — keep 5% of users on the old variant
2. Add a `holdout` block to `definition.md` recording the plan:
   ```yaml
   holdout:
     enabled: true
     percentage: 5
     check_at_days: [30, 60, 90]
     launched_at: <launch date>
   ```
3. At each checkpoint (day 30, 60, 90):
   - Collect fresh data for both groups → `input.json`
   - Run analysis with a time-stamped slug:
     ```bash
     python .featbit-release-decision/scripts/analyze-bayesian.py <slug>-holdout-30d
     ```
4. Compare P(win) and rel Δ across checkpoints — look for stability, decay, or growth
5. When holdout analysis is complete, remove the holdout split from the feature flag

For full interpretation guidance (three patterns: holds / decays / improves), see `references/analysis-holdout.md`.

### "I want to close the experiment"

1. Ensure `decision.md` exists in `.featbit-release-decision/experiments/<slug>/` — written by agent after `evidence-analysis` framing
2. Archive by moving folder to `.featbit-release-decision/experiments/archive/<slug>/` (optional)
3. Update `.featbit-release-decision/intent.md`: `stage: learning`
4. Hand off to `learning-capture`

---

## Operating Rules

- `definition.md` is the contract. Do not change `flag_key`, `primary_metric_event`, or `variants` after data collection starts — it would invalidate the data already collected.
- `observation_window.start` must match when the flag was actually enabled. Do not backfill earlier — pre-flag data is not part of the experiment.
- Verify `input.json` sanity before running analysis: `k` ≤ `n` for every row, variant keys match `definition.md`, no zero `n` values.
- Do not interpret results by eyeballing `input.json`. Always run `analyze-bayesian.py` and read `analysis.md`.
- If the SRM check flags an imbalance (χ² p < 0.01), do not proceed to `evidence-analysis` — the data is unreliable.
- "The script says 97% confidence" does not mean "ship it." That is `evidence-analysis`'s job.

---

## Handoff Chain

```
measurement-design
  → experiment-workspace   ← this skill
      → evidence-analysis
          → learning-capture
```

When handing off to `evidence-analysis`, pass the path to `analysis.md` and the original `definition.md` so the decision can be tied back to the hypothesis.

---

## Reference Files

- [references/experiment-folder-spec.md](references/experiment-folder-spec.md) — folder layout, file formats, `definition.md` template, `analysis.md` example, `decision.md` template
- [references/analysis-bayesian.md](references/analysis-bayesian.md) — Bayesian A/B analysis: metric types, prior patterns, output interpretation, sequential testing, family-wise error
- [references/analysis-bandit.md](references/analysis-bandit.md) — Bandit analysis: Thompson Sampling, `bandit-weights.json` fields, FeatBit API integration, stopping condition
- [references/analysis-holdout.md](references/analysis-holdout.md) — Holdout group: post-launch long-term validation, three effect patterns, checkpoint cadence
- [references/data-source-guide.md](references/data-source-guide.md) — input contract and §FeatBit / §Database / §Custom patterns for producing `input.json`
- [scripts/stats_utils.py](scripts/stats_utils.py) — shared statistical utilities (GaussianPrior, metric_moments, bayesian_result, srm_check, parse_*)
- [scripts/analyze-bayesian.py](scripts/analyze-bayesian.py) — ready-to-run Bayesian A/B analysis script
- [scripts/analyze-bandit.py](scripts/analyze-bandit.py) — ready-to-run Thompson Sampling weight computation script
- [scripts/collect-input.py](scripts/collect-input.py) — data collector placeholder (implement `fetch_metric_summary`)
- [scripts/check-sample.sh](scripts/check-sample.sh) — quick sample count check
