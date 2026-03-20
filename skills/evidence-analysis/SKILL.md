---
name: evidence-analysis
description: Evaluates collected data to determine if evidence is sufficient to decide, then frames the outcome as CONTINUE, PAUSE, ROLLBACK CANDIDATE, or INCONCLUSIVE. Activate when triggered by CF-06 or CF-07 from the release-decision framework, or when user says "analyze results", "should I ship this", "continue or rollback", "is this significant", "what do the results say", "has it been long enough". Do not use when data collection has not started.
license: MIT
metadata:
  author: FeatBit
  version: "1.0.0"
  category: release-management
---

# Evidence Analysis

This skill handles **CF-06: Evidence Sufficiency** and **CF-07: Decision Framing** from the release-decision framework.

CF-06 and CF-07 are handled together because they represent a continuous decision: first determine if evidence is sufficient, then frame what the evidence says.

## When to Activate

- Data is being collected and the user wants to know whether to decide now
- The user is impatient to interpret weak or early evidence
- Results exist and a go/no-go decision is needed
- `.decision-context/intent.md` shows `stage: measuring` or `stage: deciding`

## Decision Actions

### Evidence sufficiency check (CF-06 first)

Before interpreting results, confirm:

1. **Simultaneous?** — Are both variants measured over the same time window?
2. **Sufficient volume?** — Is the sample large enough to distinguish signal from noise?
3. **Clean window?** — Were there external events (promotions, outages, holidays) that could contaminate the data?
4. **Instrumentation verified?** — Are events firing correctly for both variants?

If any check fails, the right move is NOT to decide — it is to wait, fix, or extend.

### Decision framing (CF-07)

Once evidence is sufficient, frame the outcome using exactly one of these categories:

- **CONTINUE** — Primary metric positive, guardrails healthy. Proceed with planned expansion.
- **PAUSE** — Guardrail metric degraded, or signal is mixed. Investigate before expanding.
- **ROLLBACK CANDIDATE** — Evidence of harm. Guardrail degradation is significant. Flag should be reverted.
- **INCONCLUSIVE** — Insufficient data, no clear direction. Extend window or revisit instrumentation.

See [references/decision-framing-guide.md](references/decision-framing-guide.md) for how to write each category's decision statement.

### Produce the decision artifact

Write a structured decision statement to `.decision-context/decision.md` with:
- The recommendation category
- The evidence that supports it (numbers, not vague descriptions)
- The link back to the original hypothesis
- The explicit next action

## Operating Rules

- Do not let urgency substitute for evidence
- "Not enough data" is a valid and honest decision frame — do not dress it up when the real issue is impatience
- Separate "we don't know yet" from "we know it's harmful"
- Update `.decision-context/intent.md` `stage: deciding`
- Hand off to `learning-capture` immediately after the decision is made

## Reference Files

- [references/decision-framing-guide.md](references/decision-framing-guide.md) — CONTINUE/PAUSE/ROLLBACK CANDIDATE/INCONCLUSIVE language, decision statement template, common framing mistakes
- [references/tool-featbit-abtesting.md](references/tool-featbit-abtesting.md) — FeatBit experiment dashboard, reading per-variant results, confidence interpretation
