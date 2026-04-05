# FeatBit Release Decision Agent

The next paradigm for product experimentation — AI agents run the full loop from **intent to decision** autonomously, at the speed of shipping. 

---

## What This Project Does

AI has made code generation 10x faster — features get built and shipped in hours, not weeks. FeatBit feature flags give teams the stability layer: observable, risk-controlled rollouts that can be reversed in seconds. But there's a gap. Whether a feature is actually useful, how to optimize it, how to prove its value — the data experimentation layer hasn't kept up with the speed of shipping.

Most teams still ship without a hypothesis, measure five metrics and pick the one that looks good, and start the next cycle from gut feeling. **The code got faster. The thinking didn't.**

Data-driven decisions used to require a senior PM and a data scientist. This agent changes that. A junior engineer or PM — without a statistics background — can run a scientifically sound experiment, reach a statistically significant conclusion, and feed the result back into the next build cycle. Fast enough to keep up with the code generator.

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

After installation, use the slash command directly in Claude Code, GitHub Copilot, or Codex:

```
/featbit-release-decision <dictate-your-experiment-feature-or-idea>
```

For example:

```
/featbit-release-decision We want more users to complete onboarding
```

The agent will identify your current stage and apply the right control lens.

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
agent/                             ← Web UI (Next.js) for the release decision agent
  src/
    app/                           ← pages, layouts, API routes
    components/                    ← React components + shadcn/ui primitives
    lib/                           ← utilities, API clients, types
    hooks/                         ← custom React hooks
```

### Agent (Web UI)

The `agent/` folder contains a **Next.js 16** application that provides a visual interface for the release decision agent. Built with **TypeScript**, **Tailwind CSS v4**, and **shadcn/ui**.

What the UI enables:

- **Manage experiments** — Create, track, and iterate on experiments through a dashboard.
- **Run agent-guided experimentation** — Walk through the full loop (intent → hypothesis → exposure → measurement → decision → learning) via an interactive UI powered by the agent skills.
- **Configure data connections** — Connect databases, data warehouses, and FeatBit instances to feed experiment metrics.
- **View analysis results** — See Bayesian analysis, sample size checks, and decision outcomes in real time.
- **Track decisions and learnings** — Record CONTINUE / PAUSE / ROLLBACK / INCONCLUSIVE decisions and structured learnings across cycles.

```bash
# Run the web UI locally
cd agent
npm install
npm run dev
```

During a session the agent writes to your project:

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

### Agent Tech Stack

| Layer | Technology | Version |
|---|---|---|
| Framework | Next.js (App Router) | 16 |
| Language | TypeScript | 5 |
| UI | React | 19 |
| Styling | Tailwind CSS | 4 |
| Components | shadcn/ui (base-nova) | latest |
| Skills | vercel-react-best-practices | latest |

---

## Key Principles

- **No implementation without an explicit intent.** The agent will not help you build before the goal is stated.
- **No measurement without a defined hypothesis.** What you plan to measure must follow from what you claim will happen.
- **No decision without evidence framing.** Urgency is not a substitute for data quality.
- **No iteration without a written learning.** Every cycle — good, bad, or inconclusive — must produce a reusable insight.

---

## License

MIT
