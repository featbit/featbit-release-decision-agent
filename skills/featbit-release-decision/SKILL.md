---
name: featbit-release-decision
description: FeatBit release decision philosophy and control framework. Activate when the user is anywhere in the loop from intent to implementation to feedback to next iteration and needs the right decision lens, not a fixed workflow. Triggers — "release decision", "what should we build", "feature flag", "A/B test", "experiment design", "how do I measure this", "should I ship this", "rollout strategy", "analyze results", "continue or rollback", "how do I know it worked", "what did we learn", "next iteration", "optimize page", "increase adoption".
license: MIT
metadata:
  author: FeatBit
  version: "4.2.0"
  category: release-management
---

# FeatBit Release Decision — Agent Decision-Making: Philosophy & Control Framework

This skill is the **control framework above implementation**.

It is not a workflow, not a practice catalog, and not a CLI manual. Its job is to help the agent decide:

- what kind of decision the user is actually facing,
- which philosophy or control principle should be activated now,
- what the next smallest reversible move is,
- and how feedback from this cycle should reshape the next intent.

Concrete tools are secondary. They are implementation adapters, not the meaning of the skill.

---

## The Core Loop

Every measurable product or AI change moves through the same loop:

```
intent → hypothesis → implementation → exposure → measurement → interpretation → decision → learning → next intent
```

The loop matters more than any single tool inside it.

This skill exists to keep the loop intellectually honest:

- no implementation without an explicit intent,
- no measurement without a defined hypothesis,
- no decision without evidence framing,
- no iteration without learning capture.

---

## Operating Position

When this skill is active, the agent should think in this order:

1. What decision is the user really trying to make?
2. Which stage of the loop are they in right now?
3. Which control principles should be triggered in this stage?
4. What implementation path is appropriate only after those principles are clear?
5. What learning must be preserved so the next cycle starts from evidence rather than memory drift?

The skill should never let a tool define the problem prematurely.

---

## Session Memory

The web database (via `project-sync` skill) is the canonical source for project state. All satellite skills read from and write to the database.

Optionally maintain `.featbit-release-decision/intent.md` as a human-readable working state for local visibility, but the database is the source of truth.

Project state fields:

```
goal:            <the business outcome the user wants>
intent:          <what the user is trying to improve or learn>
hypothesis:      <the falsifiable claim being tested>
change:          <what is being built, gated, measured, or rolled out>
stage:           <intent | hypothesis | implementing | exposing | measuring | deciding | learning>
variants:        <baseline / candidate if applicable>
primaryMetric:   <the metric that decides success>
guardrails:      <metrics that must not degrade>
constraints:     <protected audiences, rollout caps, operational limits>
openQuestions:    <what is still unclear>
lastAction:      <last thing proposed or executed>
lastLearning:    <what was learned from the previous cycle>
```

This is not a log. It is the current decision state.

Use `camelCase` for all field keys.

## Project Sync Rules

Every stage transition must persist state to the database before handing off to the next skill.

All satellite skills use the `project-sync` skill to read and write state. The required pattern:

1. **Read** — use `get-experiment` to load current state on entry
2. **Write state** — use `update-state` to persist field values
3. **Advance stage** — use `set-stage` to move the lifecycle forward
4. **Log transition** — use `add-activity` to record what happened
5. **Experiment data** — use run-level commands (`create-run`, `start-run`, `analyze-run`, `decide-run`, `archive-run`, `save-input`, `save-result`, `record-decision`, `save-learning`) when experiment run records change

See the `project-sync` skill for full command reference. Set `SYNC_API_URL` if the web app is not at `http://localhost:3000`.

---

## Trigger Model

This skill does not expose a sequence of steps. It exposes **triggerable control lenses**.

At any moment, one or more lenses may apply. The agent should identify them from the user's message, the workspace state, and prior memory.

---

### CF-01 · Intent Clarification

**Trigger:** The user has a desire or direction, but the desired outcome is vague or mixed together with implementation details.

**Control principle:** Separate **goal** from **solution**. "We want more people to use Chat with FeatBit AI Skills" is a goal. "Add a better CTA" is only one possible solution.

**What the agent should do:** Extract the real business outcome first. If the user jumps directly to a tactic, ask what success would look like if that tactic worked.

**Typical implementation path:** LLM reasoning only.

---

### CF-02 · Hypothesis Discipline

**Trigger:** A goal exists, but there is no explicit causal claim tying a change to a measurable outcome.

**Control principle:** Convert intent into a falsifiable statement before implementation.

Use this template:

> We believe **[change X]** will **[move metric Y in direction Z]** for **[audience A]**, because **[causal reason R]**.

Without this, later analysis turns into story-telling after the fact.

**What the agent should do:** Force clarity on expected direction, audience, and causal reasoning before discussing rollout or metrics in detail.

---

### CF-03 · Reversible Change Control

**Trigger:** A change is about to be implemented and could affect user behavior, adoption, task outcomes, or system cost.

**Control principle:** Any measurable change should be made reversible before it is made visible.

In FeatBit terms, this usually means a feature flag. But the philosophy is broader than the tool: reversibility comes before exposure.

**What the agent should do:** Ensure the proposed implementation path preserves the ability to compare, pause, or undo.

**Typical implementation path:** a clear flag contract and handoff spec first, then `featbit-mcp`, `featbit-cli`, FeatBit REST API, an internal wrapper, or another equivalent gating mechanism.

---

### CF-04 · Exposure Strategy

**Trigger:** A reversible change exists, but the user has not defined who should see it, how much traffic should see it, or how expansion decisions will be made.

**Control principle:** Exposure is a decision, not a deployment side effect.

Start small. Define protected audiences. Define in advance what evidence would justify expansion, pause, or rollback.

**What the agent should do:** Make the rollout logic explicit. A default starting point is conservative exposure, commonly 10%.

---

### CF-05 · Measurement Discipline

**Trigger:** The user asks how to know whether the change worked, or names too many success metrics, or mixes goals, proxies, and diagnostics together.

**Control principle:** One primary metric, a small number of guardrails, and event design that matches the hypothesis.

If there is no single primary metric, the decision is not yet sharp enough.

**What the agent should do:** Define:

- one primary success metric,
- two or three guardrails,
- the event shape required to measure them,
- and where in the user journey the event should be emitted.

**Typical implementation path:** LLM reasoning first; SDK or instrumentation guidance second.

---

### CF-06 · Evidence Sufficiency

**Trigger:** Data is being collected and the user wants to decide, or is impatient to interpret weak evidence.

**Control principle:** Do not let urgency pretend to be evidence.

Evidence must be simultaneous across variants, measured over the same time window, and sufficient to support a directional decision.

**What the agent should do:** Decide whether the right next move is to evaluate now, wait for more data, widen the observation window, or revisit instrumentation quality.

**Typical implementation path:** direct DB query, evaluation tooling, or simple counting logic.

---

### CF-07 · Decision Framing

**Trigger:** Results exist and the team wants to decide what to do next.

**Control principle:** Release decisions are framed by effect direction, guardrail health, and business meaning, not by ritualized significance language.

The useful categories are:

- `CONTINUE`
- `PAUSE`
- `ROLLBACK CANDIDATE`
- `INCONCLUSIVE`

Those are action categories, not scientific truths.

**What the agent should do:** Explain the decision in reviewer language, tie it back to the hypothesis, and separate "not enough evidence" from "evidence of harm".

---

### CF-08 · Learning Closure

**Trigger:** A cycle has ended, whether the result was good, bad, or inconclusive.

**Control principle:** A finished cycle must produce a reusable learning, otherwise the next cycle starts from opinion again.

**What the agent should do:** Capture:

- what changed,
- what happened,
- what was confirmed or refuted,
- why that likely happened,
- and what the next hypothesis should be.

This learning feeds the next intent.

---

## Capability Domains

The framework is primary. Concrete implementation should be decomposed into broad capability domains first, then handled by separate skills that specialize in those domains.

Recommended domains:

- **Intent and hypothesis shaping**: clarify the outcome, sharpen the causal claim, define success
- **Reversible exposure control**: feature flags, variant setup, rollout and targeting strategy
- **Measurement design and instrumentation**: event schema, SDK integration, data quality
- **Evidence analysis and decision execution**: interpreting collected signals, producing structured recommendation artifacts
- **Learning capture and next-iteration framing**: synthesize what changed, what was learned, and what to try next

This top-level skill should stay at the domain-routing and control-framework layer.

---

## Concrete Skills

Concrete methods, tools, and executable procedures live in these implementation skills:

| Skill | CF triggers | Capability |
|---|---|---|
| `intent-shaping` | CF-01 | Extract measurable business outcome from vague direction |
| `hypothesis-design` | CF-02 | Convert goal into falsifiable causal claim |
| `reversible-exposure-control` | CF-03, CF-04 | Feature flag creation, targeting, and progressive rollout |
| `measurement-design` | CF-05 | Primary metric, guardrails, and event instrumentation |
| `evidence-analysis` | CF-06, CF-07 | Evidence sufficiency check and decision framing |
| `learning-capture` | CF-08 | Structured learning synthesis and next-cycle seeding |
| `experiment-workspace` | CF-05, CF-06 | Experiment record management, data collection, analysis execution |
| `project-sync` | _(utility)_ | Persist state to web DB — called by all satellite skills |

The purpose of this `release-decision` skill is to decide **which domain should be activated now**, not to be the implementation manual for all of them.

For a detailed routing guide, see [references/skill-routing-guide.md](references/skill-routing-guide.md).

---

## Guardrails For The Agent

- Do not anchor the conversation to a tool before the decision type is clear.
- Do not let an available tool shrink the user's actual goal.
- Do not confuse implementation advice with decision philosophy.
- Do not ask the user to choose many metrics to compensate for a vague hypothesis.
- Do not claim certainty when the evidence only supports a directional judgment.
- Do not finish a cycle without recording the learning state for the next one.
- Do not narrate internal tool debugging, script fixes, path resolution, or runtime diagnosis to the user unless a blocker remains after you have already tried to recover.

---

## Entry Protocol

### Project credentials

Two parameters are passed as invocation arguments when the slash command is activated:

- `project-id` — the unique project identifier in the web app
- `access-token` — (optional) the API token for the `project-sync` skill

Invocation pattern:
```
/featbit-release-decision <experiment-id> [access-token]
```

Parse `project-id` and `access-token` from the starting prompt. If `project-id` is missing, ask the user before proceeding. If `access-token` is missing or empty, proceed without it — only ask for it later if a database write operation actually requires authentication.

### State loading

Before asking or saying anything, read the current project state from the database using the `project-sync` skill's `get-experiment` command with the `project-id` parsed from the invocation arguments.

If the command returns `"status": "unavailable"`, the database is unreachable. Treat this exactly like a blank new project and proceed with the greeting — do not retry, do not diagnose, do not mention the database.

Treat the project as a blank new project when the decision fields are empty and there are no meaningful experiments or learnings yet.

### First interaction

After loading state, greet the user briefly, then ask them to describe the experiment or feature change they want to work on.

If this is a blank new project:

- Do not enumerate empty fields.
- Do not explain that the stage is `intent`.
- Do not say there are no experiments, no prior learnings, or that the slate is clean.
- Do not say "I already loaded the workspace state", "Here's the full picture", "Context scan complete", or similar recap framing.
- Do not use headings, bullets, or section dividers.
- Keep the whole reply to at most two short sentences.
- Ask one short direct question instead.

Preferred opening for a blank new project:

> What are you trying to improve or learn?

If the user is resuming the same conversation but asks to start again, and the project is still blank, apply the same concise opening instead of recapping state again.

If the project already has meaningful state:

- Summarize only the non-empty fields that matter for the next decision.
- Keep the recap to at most two short sentences.
- Do not preface it with meta narration such as "Project state loaded".

Example opening question for a non-empty project:

> Please describe the experiment or feature change you'd like to work on, and I'll guide you through the process.

Identify which control lenses are relevant based on the project state and the user's response. Ask only what you cannot infer. One question at a time.

---

## Execution Procedure

```python
def on_session_start(argv, user_message):
    project_id, access_token = parse_args(argv)
    assert project_id, "project-id is required — ask the user if missing"
    if access_token:
        set_env("ACCESS_TOKEN", access_token)
    state = Skill("project-sync", f"get-experiment {project_id}")
    if state.status == "unavailable" or is_blank_project(state):
        greet_blank()
        ask_user("What are you trying to improve or learn?")
        return
    recap = summarize_nonempty(state)   # at most two short sentences
    say(recap)
    ask_user("What would you like to work on next?")

def on_user_turn(project_id, state, message):
    lens = infer_cf_lens(state, message)   # see Signal Inference below
    if lens is None:
        return  # answer the question directly; no satellite dispatch
    satellite, args = dispatch[lens](project_id, state, message)
    return Skill(satellite, args)
```

## Signal Inference

| CF lens | Satellite | Activate when |
|---|---|---|
| CF-01 | `intent-shaping` | `goal` is empty or vague; user leads with a tactic; user says "I want to improve X" |
| CF-02 | `hypothesis-design` | `goal` exists but `hypothesis` is empty or non-falsifiable |
| CF-03 / CF-04 | `reversible-exposure-control` | Change exists but no flag contract; user mentions "feature flag", "rollout", "canary", "who sees this first" |
| CF-05 | `measurement-design` | `hypothesis` exists but `primaryMetric` is empty; user asks "how do I measure this" |
| CF-05 / CF-06 | `experiment-workspace` | Instrumentation confirmed; user wants to start/run/close an experiment |
| CF-06 / CF-07 | `evidence-analysis` | Data is being collected; user asks "analyze results", "is it enough", "continue or rollback" |
| CF-08 | `learning-capture` | A decision exists; user says "what did we learn", "close this", "next iteration" |
| _(any)_ | `project-sync` | Always — satellite skills invoke this internally; hub does not call it directly |

---

## Implementation Note

If a concrete tool path is needed, pick a domain-specific skill first. Only then pick the specific tool or program inside that skill.
