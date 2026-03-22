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
minimum_sample_per_variant: <number, e.g. 200>
hypothesis:              <copied verbatim from .featbit-release-decision/intent.md>
```

Rules for `definition.md`:
- `flag_key` must exactly match the key in FeatBit — this is how evaluation logs are filtered
- `primary_metric_event` must exactly match the event name tracked via FeatBit SDK's `track()` call
- `observation_window.start` is the date from which logs are included — do not backfill before the flag was enabled
- `minimum_sample_per_variant` is a sanity floor, not a stopping rule

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

## Primary Metric: cta_clicked

| variant   | exposed | converted | rate   | relative_change | p(treatment > control) |
|-----------|---------|-----------|--------|-----------------|------------------------|
| control   | 487     | 41        | 8.42%  | —               | —                      |
| treatment | 513     | 67        | 13.06% | +55.1%          | 97.3%                  |

## Guardrail: chat_opened

| variant   | exposed | converted | rate   | relative_change | p(treatment > control) |
|-----------|---------|-----------|--------|-----------------|------------------------|
| control   | 487     | 38        | 7.80%  | —               | —                      |
| treatment | 513     | 41        | 7.99%  | +2.4%           | 54.1%                  |

## Sample check
minimum required per variant: 200 ✓
```

Do not edit `analysis.md` by hand. Re-run the script if data changes.

---

## `decision.md`

Written by the agent after `evidence-analysis` frames the outcome. Template:

```markdown
experiment:   <slug>
decided_at:   <ISO date>
decision:     <CONTINUE | PAUSE | ROLLBACK CANDIDATE | INCONCLUSIVE>

## Evidence Summary
<2–4 sentences referencing numbers from analysis.md>

## Hypothesis Verdict
<Was the hypothesis confirmed, rejected, or inconclusive? One sentence.>

## Next Action
<What happens now — expand rollout, revert flag, extend window, or close?>

## Link to Intent
See `.featbit-release-decision/intent.md` for full hypothesis and business context.
```

---

## Naming the Experiment Slug

Use `<flag-key>-<short-description>`, e.g.:
- `chat-cta-v2`
- `homepage-h1-ai-risk`
- `hero-deploy-buttons`

Kebab-case only. Matches the flag key prefix where possible.
