---
name: learning-capture
description: Captures structured learnings at the end of an experiment or release cycle so the next iteration starts from evidence rather than memory. Activate when triggered by CF-08 from the release-decision framework, or when user says "what did we learn", "close this experiment", "we're done with this cycle", "next iteration", "this experiment is over", "capture learning". Activate immediately after a decision is made in evidence-analysis.
license: MIT
metadata:
  author: FeatBit
  version: "1.0.0"
  category: release-management
---

# Learning Capture

This skill handles **CF-08: Learning Closure** from the release-decision framework.

Its job is to produce a reusable learning at the end of every cycle — good, bad, or inconclusive — so the next iteration does not start from opinion.

## When to Activate

- A decision has been made (CONTINUE, PAUSE, ROLLBACK CANDIDATE, or INCONCLUSIVE)
- The experiment window has closed
- The user says "what did we learn" or "next iteration"
- `.featbit-release-decision/intent.md` shows `stage: deciding` and a decision exists

## What a Complete Learning Contains

1. **What changed** — the specific change that was tested (not "improved the UI")
2. **What happened** — the measured outcome with numbers
3. **Confirmed or refuted** — was the hypothesis directionally correct?
4. **Why it likely happened** — the causal interpretation (honest about uncertainty)
5. **Next hypothesis** — what this result suggests to try next

All five are required. A learning missing (4) or (5) does not close the loop.

## Decision Actions

### Produce the learning

Work through each of the five components with the user. Prompt for missing parts one at a time.

### Write to decision context

Update `.featbit-release-decision/intent.md`:
- Set `last_learning:` to a summary of the learning
- Set `stage: learning` then immediately `stage: intent` (ready for the next cycle)
- Clear `hypothesis:`, `primary_metric:`, `guardrails:` — they belong to the next cycle's form

### Surface the next hypothesis

The learning must always end with a directional suggestion for what to test next. This is not a commitment — it is the input to the next `intent-shaping` + `hypothesis-design` cycle.

## Operating Rules

- Do not allow a cycle to close without a written learning
- INCONCLUSIVE cycles still produce learnings — "we learned this measurement approach was inadequate" is valid and complete
- Do not let the learning become a post-mortem — it is forward-facing input
- For longer cycles, write a fuller document to `artifacts/learning-[date].md`
- Hand off to `intent-shaping` for the next cycle

## Reference Files

- [references/iteration-synthesis-template.md](references/iteration-synthesis-template.md) — full five-part template, confirmed/refuted/inconclusive examples, anti-patterns
