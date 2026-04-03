# Experiment Folder Spec

Every experiment is a self-contained folder inside `.featbit-release-decision/experiments/`.
The folder is the experiment. No online dashboard required.

---

## Folder Layout

```
.featbit-release-decision/
  intent.md                  ← current run state
  decision.md                ← global decision output
  experiments/
    <experiment-slug>/
      definition.md          ← agent creates this first
      input.json             ← aggregated counts (written by collect-input.py)
      analysis.md            ← computed results (written by analyze-bayesian.py)
      decision.md            ← CONTINUE / PAUSE / ROLLBACK CANDIDATE / INCONCLUSIVE
    archive/                 ← completed experiments
  scripts/
    analyze-bayesian.py      ← Bayesian analysis (copy from scripts/)
    collect-input.py         ← data collector placeholder (implement fetch_metric_summary)
    check-sample.sh          ← quick sample count check
```

All four files together = one complete experiment cycle.
`decision.md` is the last file created — it is the output that `evidence-analysis` uses.

---

## `definition.md`

The agent creates this when an experiment begins. It is the local equivalent of "creating an experiment" in an online dashboard.

```markdown
experiment:              <slug — matches folder name>
flag_key:                <flag key used in FeatBit>
primary_metric_event:    <event name that fires on the primary goal>
guardrail_events:
  - <event name 1>
  - <event name 2>
variants:
  control:               <variant value, e.g. "false" or "baseline">
  treatment:             <variant value, e.g. "true" or "candidate">
observation_window:
  start:                 <ISO 8601 date, e.g. 2026-03-01>
  end:                   <ISO 8601 date, or "open" if still running>
minimum_sample_per_variant: <number — computed by agent as ceil(30 / p_baseline), see experiment-workspace SKILL.md>
prior:
  proper:  false         # true = informative prior; false = flat/data-only (default)
  mean:    0.0           # expected relative lift (0 = no expected direction)
  stddev:  0.3           # uncertainty around prior mean (0.3 = ±30% plausible range)
hypothesis:              <copied verbatim from .featbit-release-decision/intent.md>

# Optional: holdout group plan (post-launch long-term tracking)
# holdout:
#   enabled: true
#   percentage: 5
#   check_at_days: [30, 60, 90]
#   launched_at: <ISO 8601 date when feature went to 100%>
```

Rules for `definition.md`:
- `flag_key` must exactly match the key in FeatBit — this is how evaluation logs are filtered
- `primary_metric_event` must exactly match the event name tracked via FeatBit SDK's `track()` call
- `observation_window.start` is the date from which logs are included — do not backfill before the flag was enabled
- `minimum_sample_per_variant` is a sanity floor, not a stopping rule
- `prior` block is optional — omit it or set `proper: false` for flat prior (original behaviour)
- Enable `proper: true` when you have domain knowledge about the likely lift range (e.g. past experiments). With small samples the prior pulls the result toward `mean`; with large samples the data dominates and the prior is washed out.

---

## `input.json`

Holds aggregated exposure and conversion counts for every metric and variant. Written by `collect-input.py` after querying your data source.

```json
{
  "metrics": {
    "cta_clicked": {
      "false": {"n": 487, "k": 41},
      "true":  {"n": 513, "k": 67}
    },
    "chat_opened": {
      "false": {"n": 487, "k": 38},
      "true":  {"n": 513, "k": 41}
    }
  }
}
```

Rules:
- Outer keys are event names — must match `primary_metric_event` and `guardrail_events` in `definition.md`
- Inner keys are variant values — must match `variants.control` and `variants.treatment` in `definition.md`
- `n` = unique users exposed to that variant in the observation window
- `k` = unique users who fired the event at least once, out of those `n`
- Source: see `references/data-source-guide.md` for §FeatBit / §Database / §Custom patterns

---

## `analysis.md`

Written by the analysis script after computation. Example output:

```markdown
experiment:   chat-cta-v2
computed_at:  2026-03-15T09:00:00Z
window:       2026-03-01 → 2026-03-15
control:      false
treatments:   true
prior:        flat/improper (data-only)

## SRM (Sample Ratio Mismatch)
χ² p-value: **0.4821** ✓ ok
observed n: false=487, true=513

### Primary Metric: cta_clicked

_type: proportion_

| variant | n | conv | rate | rel Δ | 95% credible CI | P(win) | risk[ctrl] | risk[trt] |
|---------|---|------|------|-------|-----------------|--------|------------|-----------|
| **false** | 487 | 41 | 8.42% | — | — | — | — | — |
| **true** | 513 | 67 | 13.06% | +55.12% | [+28.45%, +81.79%] | 97.3% | 0.0412 | 0.0012 |

> P(win)=97%  risk[ctrl]=0.0412  risk[trt]=0.0012  → strong signal → adopt treatment

### Guardrail: chat_opened

_type: proportion_

| variant | n | conv | rate | rel Δ | 95% credible CI | P(win) | risk[ctrl] | risk[trt] |
|---------|---|------|------|-------|-----------------|--------|------------|-----------|
| **false** | 487 | 38 | 7.80% | — | — | — | — | — |
| **true** | 513 | 41 | 7.99% | +2.44% | [−9.81%, +14.69%] | 54.1% | 0.0089 | 0.0084 |

> P(win)=54%  risk[ctrl]=0.0089  risk[trt]=0.0084  → inconclusive

## Sample check
minimum required per variant: 487  ✓
control (false) exposed:   487
true exposed:   513
```

Do not edit `analysis.md` by hand. Re-run the script if data changes.

---

## `decision.md`

Written by the agent after `evidence-analysis` frames the outcome. Template:

```markdown
Experiment:         <slug>
Observation window: <start date> to <end date>
Sample:             <N users per variant> — minimum required: <minimum_sample_per_variant>
SRM check:          <✓ ok / ⚠ failed — p = X>

Hypothesis: <copied from intent.md>

Primary metric: <metric name>
  Baseline (control):  <rate or mean>
  Candidate:           <rate or mean>
  Relative change:     <rel Δ>
  P(win):              <X>%
  risk[trt]:           <value>
  risk[ctrl]:          <value>
  95% credible CI:     [<lower>, <upper>]

Guardrails:
  <guardrail 1>: P(win) = <X>%  — <healthy / possible harm / strong harm>
  <guardrail 2>: P(win) = <X>%  — <healthy / possible harm / strong harm>

Decision: <CONTINUE | PAUSE | ROLLBACK CANDIDATE | INCONCLUSIVE>

Reasoning: <2–3 sentences tying the evidence to the hypothesis and the decision category>

Next action: <specific step — expand to X%, disable flag, extend window, investigate Y>
```

---

## Naming the Experiment Slug

Use `<flag-key>-<short-description>`, e.g.:
- `chat-cta-v2`
- `homepage-h1-ai-risk`
- `hero-deploy-buttons`

Kebab-case only. Matches the flag key prefix where possible.
