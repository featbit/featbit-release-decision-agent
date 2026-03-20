---
name: reversible-exposure-control
description: Makes product or AI changes reversible before they are visible, and defines who sees the change, how much traffic, and how expansion will be controlled. Activate when triggered by CF-03 or CF-04 from the release-decision framework, or when user says "feature flag", "should I ship this", "rollout strategy", "gradual rollout", "canary", "5% of users", "start exposing", "who sees this first", "create a flag". Default tool adapter — FeatBit CLI.
license: MIT
metadata:
  author: FeatBit
  version: "1.0.0"
  category: release-management
---

# Reversible Exposure Control

This skill handles **CF-03: Reversible Change Control** and **CF-04: Exposure Strategy** from the release-decision framework.

These two control principles are handled together because they represent a single user decision intent: "I want to start showing this to users in a controlled way."

## When to Activate

- A change is about to be implemented that will affect user behavior, adoption, or outcomes
- A change exists but is not yet behind a flag (not reversible)
- A flag exists but exposure strategy is undefined or implicit
- User asks about rollout percentages, targeting, or who should see a variant
- `.decision-context/intent.md` shows `stage: implementing` or `stage: exposing`

## Decision Actions (by user intent)

### "I want to create a flag for this change"

1. Confirm flag key naming (kebab-case, descriptive, environment-agnostic)
2. Define variants: baseline (control) and candidate (treatment)
3. Create the flag in the OFF state first
4. Read: [references/tool-featbit-cli.md](references/tool-featbit-cli.md) for execution

### "I want to start rolling this out"

1. Confirm hypothesis and primary metric exist first
2. Confirm who is protected (must NOT see the candidate)
3. Set initial exposure: default 5-10%
4. Define expansion criteria in advance — what evidence justifies moving to 25%, 50%, 100%
5. Define rollback triggers — what signals cause immediate revert
6. Read: [references/rollout-patterns.md](references/rollout-patterns.md) for strategy
7. Read: [references/tool-featbit-cli.md](references/tool-featbit-cli.md) for execution

### "I want to target a specific audience"

1. Identify the targeting rule: user property, segment, or custom attribute
2. Confirm this audience is the right proxy for the hypothesis audience
3. Set the targeting rule before setting the percentage
4. Read: [references/tool-featbit-cli.md](references/tool-featbit-cli.md) for execution

## Operating Rules

- Reversibility (flag exists) must be confirmed before exposure begins
- Never start at 100% unless protected audience targeting is explicitly intentional
- Document expansion and rollback criteria in `.decision-context/intent.md` under `constraints:`
- Hand off to `measurement-design` if instrumentation is not confirmed before exposure begins
- Update `stage: exposing` in `.decision-context/intent.md` when exposure begins

## Reference Files

- [references/rollout-patterns.md](references/rollout-patterns.md) — vendor-agnostic rollout strategy, progressive exposure, protected audience guidance
- [references/tool-featbit-cli.md](references/tool-featbit-cli.md) — FeatBit CLI commands for flag creation, targeting rules, percentage rollout
