---
name: hypothesis-design
description: Converts a clear business goal into a falsifiable hypothesis before implementation begins. Activate when triggered by CF-02 from the release-decision framework, or when a goal exists but there is no explicit causal claim linking a change to an expected outcome. Triggers — "write a hypothesis", "what do we expect", "what should we test", "we think this will work because". Do not use when the hypothesis is already sharp and falsifiable.
license: MIT
metadata:
  author: FeatBit
  version: "1.0.0"
  category: release-management
---

# Hypothesis Design

This skill handles **CF-02: Hypothesis Discipline** from the release-decision framework.

Its job is to convert a goal into a testable, falsifiable statement before any implementation or measurement work begins.

## When to Activate

- Goal exists but no causal claim links the change to the outcome
- User says "we think this will help" without explaining the mechanism
- `hypothesis:` in `.decision-context/intent.md` is empty or non-falsifiable
- User is about to build without stating what they expect

## Core Template

> We believe **[change X]** will **[move metric Y in direction Z]** for **[audience A]**, because **[causal reason R]**.

Every component is required. A hypothesis without a causal reason is a hope, not a testable claim.

## Validation Questions

Check each component:

1. **Change X** — Is this specific enough to implement? Could two engineers build the same thing from this description?
2. **Metric Y** — Is this measurable? Does instrumentation exist or can it be built?
3. **Direction Z** — Is the direction stated (increase / decrease / maintain)?
4. **Audience A** — Is the target audience specific enough to be segmented in analysis?
5. **Reason R** — Is the causal mechanism explicit? "Because users will like it" is not a reason.

## Decision Actions

### Draft the hypothesis

Work with the user to fill all five components. Ask about missing parts one at a time.

### Test for falsifiability

Ask: "Under what conditions would we conclude this hypothesis was wrong?" If the answer is "none", it is not falsifiable.

### Sharpen the metric claim (optional)

The hypothesis does not need a specific number at this stage. It needs a direction. Quantitative targets belong in the evaluation plan, not the hypothesis.

## Operating Rules

- Do not proceed to implementation planning until all five components are present
- Do not conflate the hypothesis with the success threshold (that belongs in `evidence-analysis`)
- Update `.decision-context/intent.md` `hypothesis:`, `variants:`, and `primary_metric:` when complete
- Hand off to `reversible-exposure-control` once hypothesis is confirmed

## Reference Files

- [references/hypothesis-template.md](references/hypothesis-template.md) — full template, good/bad examples, falsifiability check, what belongs here vs. in evidence-analysis
