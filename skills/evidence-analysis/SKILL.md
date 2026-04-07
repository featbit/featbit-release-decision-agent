---
name: evidence-analysis
description: Evaluates collected data to determine if evidence is sufficient to decide, then frames the outcome as CONTINUE, PAUSE, ROLLBACK CANDIDATE, or INCONCLUSIVE. Activate when triggered by CF-06 or CF-07 from the release-decision framework, or when user says "analyze results", "should I ship this", "continue or rollback", "is this significant", "what do the results say", "has it been long enough". Do not use when data collection has not started.
license: MIT
metadata:
  author: FeatBit
  version: "1.1.0"
  category: release-management
---

# Evidence Analysis

This skill handles **CF-06: Evidence Sufficiency** and **CF-07: Decision Framing** from the release-decision framework.

CF-06 and CF-07 are handled together because they represent a continuous decision: first determine if evidence is sufficient, then frame what the evidence says.

## When to Activate

- Data is being collected and the user wants to know whether to decide now
- The user is impatient to interpret weak or early evidence
- Results exist and a go/no-go decision is needed
- Project stage is `measuring` or `deciding`

## On Entry — Read Current State

Before doing any work, read the project from the database using the `project-sync` skill's `get-project` command.

Check these fields:

| Field | Purpose |
|---|---|
| `primaryMetric` | The metric that decides the outcome |
| `guardrails` | Metrics that must not degrade |
| `hypothesis` | The causal claim being tested |
| `stage` | Current lifecycle position |
| `experiments` | Existing experiment records and their status |

- If `primaryMetric` is empty → redirect to `measurement-design`
- If `stage` is `deciding` → a decision may already exist; check experiment records before re-analyzing
- If experiment records already have a `decision` field → may only need to review, not re-decide

## Decision Actions

### Evidence sufficiency check (CF-06 first)

Before interpreting results, confirm:

1. **Simultaneous?** — Are both variants measured over the same time window?
2. **Sufficient volume?** — Sample per variant ≥ `minimumSample` in the experiment record. If below this floor, the Gaussian approximation is unreliable — do not interpret P(win) or risk values yet.
3. **Risk has had a chance to converge?** — Read the experiment's `analysisResult` and check that `risk[trt]` and `risk[ctrl]` are not both still very high (> 0.02). If both are high, the posterior is still wide — more data is needed regardless of what P(win) shows.
4. **Clean window?** — Were there external events (promotions, outages, holidays) that could contaminate the data?
5. **Instrumentation verified?** — Are events firing correctly for both variants?
6. **SRM check passed?** — `analysisResult` includes a χ² SRM check. If it flags an imbalance (p < 0.01), do not interpret metric results until the traffic split issue is resolved.

If any check fails, the right move is NOT to decide — it is to wait, fix, or extend.

### Decision framing (CF-07)

Once evidence is sufficient, read the experiment's `analysisResult` and frame the outcome using exactly one of these categories:

- **CONTINUE** — Primary metric P(win) ≥ 95% and risk[trt] is low. Guardrail P(win) all > 20%. Proceed with planned expansion.
- **PAUSE** — Primary metric P(win) 80–95%, or a guardrail P(win) ≤ 20%, or SRM check failed. Signal exists but is not clean enough to expand. Investigate before proceeding.
- **ROLLBACK CANDIDATE** — A guardrail P(win) ≤ 5%, or primary metric P(win) ≤ 5%. Evidence of harm. Flag should be reverted.
- **INCONCLUSIVE** — Sample below validity floor, or risk[trt] and risk[ctrl] both still high, or primary metric P(win) 20–80% after a full observation window. Extend window or revisit instrumentation.

See [references/decision-framing-guide.md](references/decision-framing-guide.md) for how to write each category's decision statement and what counts as "low" for risk values.

### Produce the decision artifact

Write a structured decision statement with:
- The recommendation category
- The evidence that supports it (numbers, not vague descriptions)
- The link back to the original hypothesis
- The explicit next action

## Operating Rules

- Do not let urgency substitute for evidence
- "Not enough data" is a valid and honest decision frame — do not dress it up when the real issue is impatience
- Separate "we don't know yet" from "we know it's harmful"
- Hand off to `learning-capture` immediately after the decision is made

### Persist State

After completing work, use the `project-sync` skill to persist state to the database:

1. `update-state` — save `--lastAction "Decision: <category>"`
2. `set-stage` — set to `deciding`
3. `upsert-experiment` — save `--decision <category> --decisionSummary "plain-language action" --decisionReason "technical rationale with data"`
4. `add-activity` — record what happened, e.g. `--type decision --title "Decision: <category>"`

## Reference Files

- [references/decision-framing-guide.md](references/decision-framing-guide.md) — CONTINUE/PAUSE/ROLLBACK CANDIDATE/INCONCLUSIVE language, decision statement template, common framing mistakes
- [references/tool-featbit-abtesting.md](references/tool-featbit-abtesting.md) — FeatBit experiment dashboard, reading per-variant results, confidence interpretation
