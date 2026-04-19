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

Before doing any work, read the project from the database using the `project-sync` skill's `get-experiment` command.

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

Use `Skill("project-sync", ...)` to sync state. All three writes are required, and instrumentation must be confirmed before writing:

```python
assert Skill("project-sync", f'update-state {experiment_id} --primaryMetric "{metric_event} — {rationale}" --guardrails "{guardrail_list}" --lastAction "Metrics defined"').ok
assert Skill("project-sync", f"set-stage {experiment_id} measuring").ok
assert Skill("project-sync", f'add-activity {experiment_id} --type stage_update --title "Metrics defined"').ok
```

**`primaryMetric` field format:** plain-text prose — event name + rationale for choosing it.  
Example: `"purchase_completed — chosen as north star because it directly measures the revenue impact of the checkout redesign."`  
Downstream skills extract the bare event name by splitting on ` — ` and taking the left token.

## Execution Procedure

```python
def design_measurement(project_id, user_message):
    state = Skill("project-sync", f"get-experiment {project_id}")
    if state.hypothesis in ("", None):
        Skill("hypothesis-design", project_id)
        return
    # --- primary metric ---
    # ask: "if you had ONE number to make a go/no-go decision, what is it?"
    primary_metric = elicit_primary_metric(state, user_message)
    # --- guardrails (2–3 max) ---
    guardrails = elicit_guardrails(state)
    # --- event design ---
    events = design_events(primary_metric, guardrails)
    # --- instrumentation gate ---
    instrumentation_confirmed = confirm_instrumentation(events)
    if not instrumentation_confirmed:
        say("Instrumentation must be confirmed before exposure begins.")
        return  # do not advance stage until confirmed
    assert Skill("project-sync", f'update-state {project_id} --primaryMetric "{primary_metric.event} — {primary_metric.rationale}" --guardrails "{guardrails_text}" --lastAction "Metrics defined"').ok
    assert Skill("project-sync", f"set-stage {project_id} measuring").ok
    assert Skill("project-sync", f'add-activity {project_id} --type stage_update --title "Metrics defined"').ok
    Skill("reversible-exposure-control", project_id)
```

## Signal Inference

| Check | Rule |
|---|---|
| `hypothesis` empty | Redirect to `hypothesis-design` |
| User lists multiple "primary" metrics | Push back — ask which ONE decides the go/no-go |
| Guardrail count > 3 | Ask which 2–3 matter most; trim the rest to diagnostics |
| Instrumentation not confirmed | Block stage advance; do not write `set-stage measuring` |
| Traffic split planned (concurrent experiments) | Flag that sample size must be calculated on the reduced traffic slice, not full traffic |

## Reference Files

- [references/event-schema-design.md](references/event-schema-design.md) — TrackPayload shape, event naming conventions, metric-to-event mapping, anti-patterns
- [references/tool-featbit-sdk.md](references/tool-featbit-sdk.md) — FeatBit SDK track() usage, experiment event association, sendToExperiment
