---
name: measurement-design
description: Defines the primary success metric, guardrails, and event instrumentation for a hypothesis before exposure begins. Activate when triggered by CF-05 from the release-decision framework, or when user asks "how do I measure this", "what metrics should I use", "what should I track", "how do I instrument this", "event design", "what is the primary metric". Do not use when metrics are already well-defined and instrumentation is complete.
license: MIT
metadata:
  author: FeatBit
  version: "1.1.0"
  category: release-management
---

# Measurement Design

This skill handles **CF-05: Measurement Discipline** from the release-decision framework.

Its job is to ensure every hypothesis has exactly one primary metric, a small set of guardrails, and an event schema that can produce evidence for the decision.

## When to Activate

- Hypothesis exists but no primary metric is defined
- User names multiple competing success metrics
- User mixes goals, proxies, and diagnostics together
- Instrumentation does not exist for the desired outcome
- Project `primaryMetric` field is empty or contains a list

## On Entry — Read Current State

Before doing any work, read the project from the database using the `project-sync` skill's `get-project` command.

Check these fields:

| Field | Purpose |
|---|---|
| `hypothesis` | Confirms causal claim exists |
| `primaryMetric` | Current metric definition (may be empty) |
| `guardrails` | Existing guardrail metrics |
| `stage` | Current lifecycle position |

- If `hypothesis` is empty → redirect to `hypothesis-design`
- If `primaryMetric` is already defined and instrumentation is confirmed → may not need this skill
- If `guardrails` already exist → build on existing rather than overwriting

## Core Principle

**One primary metric decides the outcome. Everything else is a guardrail or diagnostic.**

If two metrics both "decide" success, the decision is not yet sharp enough. Return to `hypothesis-design`.

## Decision Actions

### Define the primary metric

Ask: "If this experiment runs for 2 weeks and you had to make a go/no-go decision with ONE number, what is that number?"

The answer is the primary metric. One only.

### Define guardrails (2–3 maximum)

Ask: "What other metrics would concern you if they degraded significantly, even if the primary metric improved?"

Common guardrails:
- Error rate / p99 latency for the candidate variant
- User satisfaction score or support ticket volume
- A downstream conversion step after the primary metric

### Design the event

For each metric, define:
- Event name (what action fires it)
- Required properties (user_key, session_id, relevant context)
- Where in the user journey it fires
- Whether it needs to be associated with a flag evaluation for experiment analysis

### Verify instrumentation completeness

Check: can the current codebase emit this event? If not, instrumentation must be built before exposure begins.

## Operating Rules

- Do not allow exposure to start without confirmed instrumentation
- One primary metric only — push back on lists
- Guardrails protect against harm, not success. They should not be optimized for.
- When multiple experiments share a flag or user pool, verify traffic allocation strategy before calculating sample size. Sequential experiments get full traffic; concurrent experiments with mutual exclusion get only their slice. An underpowered experiment due to traffic splitting is worse than waiting for a sequential slot. See `reversible-exposure-control` → [multi-experiment-traffic.md](../reversible-exposure-control/references/multi-experiment-traffic.md) for patterns.
- Hand off to `reversible-exposure-control` when instrumentation is complete
- Hand off to `evidence-analysis` once data collection is underway

### Persist State

After completing work, use the `project-sync` skill to persist state to the database:

1. `update-state` — save `--primaryMetric "<metric>"` and `--guardrails "<guardrail list>"`
2. `set-stage` — set to `measuring`
3. `add-activity` — record what happened, e.g. `--type stage_update --title "Metrics defined"`

## Reference Files

- [references/event-schema-design.md](references/event-schema-design.md) — vendor-agnostic event design principles, naming conventions, metric-to-event mapping, anti-patterns
- [references/tool-featbit-sdk.md](references/tool-featbit-sdk.md) — FeatBit SDK track() usage, experiment event association, sendToExperiment
