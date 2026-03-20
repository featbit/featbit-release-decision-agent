---
name: featbit-release-decision
description: FeatBit release decision philosophy and control framework. Activate when the user is anywhere in the loop from intent to implementation to feedback to next iteration and needs the right decision lens, not a fixed workflow. Triggers — "release decision", "what should we build", "feature flag", "A/B test", "experiment design", "how do I measure this", "should I ship this", "rollout strategy", "analyze results", "continue or rollback", "how do I know it worked", "what did we learn", "next iteration", "optimize page", "increase adoption".
license: MIT
metadata:
  author: FeatBit
  version: "4.0.0"
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

Maintain `.decision-context/intent.md`. Create it on first contact and keep it current.

```
goal:            <the business outcome the user wants>
intent:          <what the user is trying to improve or learn>
hypothesis:      <the falsifiable claim being tested>
change:          <what is being built, gated, measured, or rolled out>
stage:           <intent | hypothesis | implementing | exposing | measuring | deciding | learning>
variants:        <baseline / candidate if applicable>
primary_metric:  <the metric that decides success>
guardrails:      <metrics that must not degrade>
constraints:     <protected audiences, rollout caps, operational limits>
open_questions:  <what is still unclear>
last_action:     <last thing proposed or executed>
last_learning:   <what was learned from the previous cycle>
```

This file is not a log. It is the current decision state.

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

**Typical implementation path:** `featbit-mcp`, `featbit-cli`, FeatBit REST API, or an equivalent gating mechanism.

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

---

## Entry Protocol

Before asking or saying anything, scan the workspace for existing context:

```
.decision-context/intent.md  → Prior decision state and last learning
artifacts/results.json       → Evidence already interpreted?
artifacts/plan.json          → Evaluation structure already proposed?
artifacts/catalog.json       → Evidence source already inspected?
existing docs or notes       → Any prior human-written problem framing?
```

Identify which control lenses are relevant based on the scan and the current message. Ask only what you cannot infer. One question at a time.

---

## Implementation Note

If a concrete tool path is needed, pick a domain-specific skill first. Only then pick the specific tool or program inside that skill.
