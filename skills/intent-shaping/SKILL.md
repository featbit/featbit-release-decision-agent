---
name: intent-shaping
description: Extracts the real business outcome when the user has a vague direction or jumps to tactics before the goal is clear. Activate when triggered by CF-01 from the release-decision framework, or when user says "I want to improve X", "we should add Y", "increase adoption", "make it better", or describes a tactic without stating a goal. Do not use when the goal is already measurable and specific.
license: MIT
metadata:
  author: FeatBit
  version: "1.0.0"
  category: release-management
---

# Intent Shaping

This skill handles **CF-01: Intent Clarification** from the release-decision framework.

Its job is to extract a real, measurable business outcome from a vague or tactic-first statement before any hypothesis, implementation, or measurement work begins.

## When to Activate

- User describes a desire without a measurable outcome ("we want more engagement")
- User names a solution before naming the problem ("we should add a better CTA")
- User mixes goal and implementation ("improve the onboarding flow so users see the feature")
- `.decision-context/intent.md` has `goal:` empty or vague

## Core Principle

Separate **what we want to happen in the world** from **what we plan to build**.

A goal is a desired change in user behavior or a business metric. A solution is one possible path to that goal. Neither can stand in for the other.

## Decision Actions

### Tactic-first detection

If the user leads with a solution, ask what outcome that solution is meant to produce.

> "If that [tactic] works exactly as intended, what would you expect to see change — and for whom?"

### Outcome extraction

Once a direction exists, sharpen it into a measurable form:

- What specific behavior or metric should change?
- For which audience?
- From what baseline?

### Scope check

Confirm the goal belongs to this iteration — not a 6-month vision.

## Operating Rules

- Ask one question at a time
- Never proceed to hypothesis or implementation until goal is measurable
- Update `.decision-context/intent.md` `goal:` and `intent:` fields when clarity is reached
- Hand off to `hypothesis-design` once the goal is sharp

## Reference Files

- [references/goal-extraction-patterns.md](references/goal-extraction-patterns.md) — question sequences, vague→clear examples, common anti-patterns
