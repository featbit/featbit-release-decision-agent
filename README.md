# FeatBit Release Decision Agent

The next paradigm for product experimentation — AI agents run the full loop from **intent to decision** autonomously, at the speed of shipping. 

---

## What This Project Does

Silicon Valley spent two decades turning product experimentation into a billion-dollar market — Optimizely, Amplitude, LaunchDarkly, Statsig, PostHog — built on the assumption that every step requires a senior PM or data scientist. AI has made coding 10x faster and product iteration faster. But if experimentation doesn't keep up, that acceleration is fake growth.

Most teams still ship without a hypothesis, measure five metrics and pick the one that looks good, and start the next cycle from gut feeling. **The tooling got faster. The thinking didn't.**

This agent skill set closes that gap. It activates a set of **control lenses** — not a fixed workflow, but a set of principles that apply at whatever stage of the loop the user is currently in — and routes to the right implementation tools only after the decision thinking is clear. Humans can step in at any point, or just make the final call.

The agent keeps a live decision state file (`.featbit-release-decision/intent.md`) across the session so context is never lost between steps.

---

## The Loop

Every measurable product or AI change moves through the same cycle:

```
intent → hypothesis → implementation → exposure → measurement → interpretation → decision → learning → next intent
```

The loop is the framework. Tools are adapters inside it.

---

## Architecture

`featbit-release-decision` is the **hub skill** — the control framework that decides which lens to apply and which satellite skill to call. All other skills are triggered by it.

```
                    ┌─────────────────────────────┐
                    │   release-decision.prompt.md │  ← entry point (VS Code / Copilot)
                    └──────────────┬──────────────┘
                                   │
                    ┌──────────────▼──────────────┐
                    │    featbit-release-decision  │  ← hub: control framework CF-01…CF-08
                    └──┬──────┬──────┬──────┬─────┘
                       │      │      │      │
          ┌────────────┘      │      │      └────────────────┐
          │                   │      │                        │
    ┌─────▼──────┐  ┌─────────▼──┐  ┌▼──────────────┐  ┌────▼──────────┐
    │  intent-   │  │ hypothesis │  │  reversible-  │  │ measurement-  │
    │  shaping   │  │  -design   │  │   exposure-   │  │   design      │
    │  (CF-01)   │  │  (CF-02)   │  │   control     │  │   (CF-05)     │
    └────────────┘  └────────────┘  │ (CF-03/CF-04) │  └───────┬───────┘
                                    └───────────────┘          │
                                                        ┌───────▼───────┐
                                                        │  experiment-  │
                                                        │   workspace   │
                                                        └───────┬───────┘
                                                                │
                                                    ┌───────────▼──────────┐
                                                    │  evidence-analysis   │
                                                    │    (CF-06/CF-07)     │
                                                    └───────────┬──────────┘
                                                                │
                                                    ┌───────────▼──────────┐
                                                    │  learning-capture    │
                                                    │      (CF-08)         │
                                                    └──────────────────────┘
```

### Skills at a Glance

| Skill | CF | Activates when… |
|---|---|---|
| `intent-shaping` | CF-01 | Goal is vague or user jumps straight to a tactic |
| `hypothesis-design` | CF-02 | Goal exists but no falsifiable causal claim |
| `reversible-exposure-control` | CF-03 / CF-04 | Ready to implement; need a feature flag and rollout strategy |
| `measurement-design` | CF-05 | Need to define the primary metric, guardrails, and event schema |
| `experiment-workspace` | CF-05 (after) | Instrumentation confirmed; ready to collect and compute |
| `evidence-analysis` | CF-06 / CF-07 | Data collected; time to decide CONTINUE / PAUSE / ROLLBACK / INCONCLUSIVE |
| `learning-capture` | CF-08 | Cycle ends; capture a reusable learning for the next iteration |

---

## Getting Started

### Prerequisites

- An AI coding agent: [GitHub Copilot](https://github.com/features/copilot) (agent mode), [Claude Code](https://claude.ai/code), or [Codex](https://openai.com/codex)
- Node.js 24+ and/or Python 3 runtime installed; .NET preferred but optional
- FeatBit account ([optional](https://github.com/featbit/featbit)) / [FeatBit Skills](https://github.com/featbit/featbit-skills) (optional) / `featbit` CLI (optional) — or substitute your own feature flag system and database / data warehouse

### Installation

```bash
# Install this skill set into your agent skills folder
npx skills add featbit/featbit-release-decision-agent
```

Or clone manually into your local skills directory and point your agent at the `instructions/` folder.

### Activation

Load `instructions/release-decision.prompt.md` into your coding agent as the system prompt or active instruction file.

**Claude Code**
```bash
cc --system instructions/release-decision.prompt.md
```

**GitHub Copilot (VS Code)**  
Open agent mode and select the **FeatBit Release Decision** custom mode, or attach the prompt file directly to the chat.

**Codex CLI**
```bash
codex --instructions instructions/release-decision.prompt.md
```

Then describe your goal — the agent will identify your current stage and apply the right control lens:

```
We want more users to complete onboarding
```

---

## How a Typical Session Works

**1. You describe a goal or a problem.**

> "We want to increase adoption of our new AI assistant feature."

The agent applies **CF-01** via `intent-shaping` — it separates your goal from any solution you may have mixed in, and asks what measurable change would tell you the goal was achieved.

**2. You refine the goal into a hypothesis.**

> "We believe adding an in-context tooltip will increase feature activation rate for new users by 15%, because they don't know the feature exists."

The agent applies **CF-02** via `hypothesis-design` — it validates all five components (change, metric, direction, audience, causal reason) and writes the hypothesis to `.featbit-release-decision/intent.md`.

**3. You implement the change behind a feature flag.**

The agent applies **CF-03 / CF-04** via `reversible-exposure-control` — it creates a flag, sets a conservative initial rollout (5–10%), defines protected audiences, and sets expansion and rollback criteria.

**4. You define instrumentation.**

The agent applies **CF-05** via `measurement-design` — one primary metric, two or three guardrails, and the event schema needed to measure them. If data collection needs to be set up, it hands off to `experiment-workspace`.

**5. Data accumulates. You want to decide.**

The agent applies **CF-06 / CF-07** via `evidence-analysis` — it checks that the evidence is simultaneous, sufficient, and clean before framing an outcome. The decision is one of: **CONTINUE**, **PAUSE**, **ROLLBACK CANDIDATE**, or **INCONCLUSIVE**. It writes the outcome to `.featbit-release-decision/decision.md`.

**6. The cycle ends.**

The agent applies **CF-08** via `learning-capture` — it produces a structured learning (what changed, what happened, why it likely happened, what to test next) and resets the intent state for the next iteration.

---

## Project Structure

```
instructions/
  release-decision.prompt.md       ← agent entry point
skills/
  featbit-release-decision/        ← hub control framework (CF-01…CF-08)
    SKILL.md
    references/
      skill-routing-guide.md       ← maps each CF to its satellite skill
  intent-shaping/                  ← CF-01: extract measurable business goals
  hypothesis-design/               ← CF-02: write falsifiable hypotheses
  reversible-exposure-control/     ← CF-03/CF-04: feature flags and rollout
  measurement-design/              ← CF-05: metrics, guardrails, event schema
  experiment-workspace/            ← CF-05+: local experiment folder + analysis scripts
  evidence-analysis/               ← CF-06/CF-07: sufficiency check + decision framing
  learning-capture/                ← CF-08: structured learning for next cycle
```

During a session the agent also writes to your project:

```
.featbit-release-decision/
  intent.md          ← live decision state (goal, hypothesis, stage, metrics…)
  decision.md        ← decision output after evidence-analysis
  experiments/
    <slug>/
      definition.md  ← experiment spec
      input.json     ← collected data
      analysis.md    ← Bayesian analysis output
```

---

## Key Principles

- **No implementation without an explicit intent.** The agent will not help you build before the goal is stated.
- **No measurement without a defined hypothesis.** What you plan to measure must follow from what you claim will happen.
- **No decision without evidence framing.** Urgency is not a substitute for data quality.
- **No iteration without a written learning.** Every cycle — good, bad, or inconclusive — must produce a reusable insight.

---

## License

MIT
