# Decision Framing Guide

## TOC

- [The Four Categories](#the-four-categories)
- [Common Framing Mistakes](#common-framing-mistakes)
- [Decision Statement Template](#decision-statement-template)

## The Four Categories

These are **action categories**, not statistical verdicts. They exist to produce a clear next step, not a scientific conclusion.

---

### CONTINUE

**Meaning:** The evidence supports proceeding with the planned rollout expansion.

**Conditions:**
- Primary metric is moving in the expected direction
- All guardrail metrics are within acceptable range
- Observation window is complete

**What to say:**
> "The primary metric [metric name] shows [direction] of [magnitude] for the candidate variant. Guardrails are healthy. Recommend proceeding to Phase 2 at [next %]."

---

### PAUSE

**Meaning:** Something needs investigation before the rollout expands. Not necessarily harmful — unclear.

**Conditions:**
- A guardrail metric shows unexpected movement (not necessarily crossed threshold yet)
- The primary metric is flat or mixed across user segments
- An instrumentation anomaly was detected

**What to say:**
> "The primary metric shows [direction], but [guardrail metric] has moved [direction] beyond the expected range. Recommend pausing at current exposure while investigating [specific signal]."

---

### ROLLBACK CANDIDATE

**Meaning:** Evidence indicates the candidate variant is causing harm.

**Conditions:**
- A guardrail metric has degraded beyond the pre-defined rollback threshold
- Primary metric has moved in the wrong direction with sufficient sample
- Critical errors or regressions are attributable to the candidate variant

**What to say:**
> "Evidence indicates the candidate variant is degrading [guardrail metric] by [magnitude]. This exceeds the pre-defined rollback threshold of [threshold]. Recommend disabling the candidate variant immediately and investigating [root cause area]."

Do NOT soften ROLLBACK CANDIDATE language. Clarity is operational here.

---

### INCONCLUSIVE

**Meaning:** The collected evidence is genuinely insufficient to support a directional decision.

**Conditions:**
- Sample size is too small to distinguish signal from noise
- External contamination (holiday, marketing event, outage) compromised the window
- Both variants show essentially identical results and more time would help

**What to say:**
> "Current evidence is insufficient for a directional decision. [Sample size] exposures were collected over [X days]. The primary metric shows [direction] of [magnitude], which is within noise range at this sample size. Recommend extending the observation window by [time] before deciding."

---

## Common Framing Mistakes

**Calling INCONCLUSIVE when you mean CONTINUE**  
If the primary metric is positive but you're uncertain, that's CONTINUE with a confidence note — not INCONCLUSIVE.

**Calling PAUSE when you mean ROLLBACK CANDIDATE**  
Do not soften "evidence of harm" into "let's investigate." If a pre-defined rollback threshold was crossed, the category is ROLLBACK CANDIDATE regardless of discomfort with the decision.

**Citing p-values as the decision basis**  
The categories are framed by business impact, not statistical significance language. "p < 0.05" tells reviewers nothing actionable. "Conversion rate increased by 4.2 percentage points across 3,400 sessions" does.

**Waiting for certainty before framing**  
These categories support decisions under uncertainty. INCONCLUSIVE is a valid and honest frame — use it rather than delaying.

---

## Decision Statement Template

```
Experiment:         [flag key / experiment name]
Observation window: [start date] to [end date]
Sample:             [N users per variant]

Hypothesis: [paste from intent.md]

Primary metric: [metric name]
  Baseline:   [value]
  Candidate:  [value]
  Direction:  [expected / unexpected]

Guardrails:
  [guardrail 1]: [healthy / degraded / within range]
  [guardrail 2]: [healthy / degraded / within range]

Decision: [CONTINUE / PAUSE / ROLLBACK CANDIDATE / INCONCLUSIVE]

Reasoning: [2–3 sentences tying the evidence to the hypothesis and the decision category]

Next action: [specific step — expand to X%, disable flag, extend window, investigate Y]
```
