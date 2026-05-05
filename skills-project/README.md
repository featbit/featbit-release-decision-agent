# skills-project

> Gives project-agent a memory and a voice — so every experiment recommendation is grounded in what your product actually does and what your team already knows.

[![License: Apache 2.0][license-shield]][license-url]
[![Version][version-shield]][version-url]
[![Agent Skills][skills-shield]][skills-url]

<div align="center">
  <a href="#skills">Skills</a> &middot;
  <a href="#quick-start">Quick Start</a> &middot;
  <a href="#prerequisites">Prerequisites</a> &middot;
  <a href="#whats-inside">What's Inside</a>
</div>

---

## The Problem

Without grounded product context, every downstream experiment suggestion is guessing. Agents re-ask questions that were already answered, recommend strategies mismatched to the product stage, and produce hypothesis statements with no connection to what actually matters to the team.

These skills give project-agent a persistent memory and a structured intake process — so context is captured once and stays available across every session, every experiment, and every collaborator on the project.

## Skills

| Skill | When to use |
|-------|-------------|
| [product-context-elicitation](product-context-elicitation/SKILL.md) | First login, first project creation, or when project memory is missing canonical product facts. Two-phase: user calibration then up to seven product context questions. |
| [project-memory-read](project-memory-read/SKILL.md) | Session start, top of any substantive user turn, or when another skill needs to check what is already on file before asking a question. |
| [project-memory-write](project-memory-write/SKILL.md) | Called by other skills to persist a confirmed fact. Every write carries provenance — source agent and user id — so the audit trail is always intact. |

These three skills are siblings. `product-context-elicitation` calls the other two; `project-memory-read` and `project-memory-write` are terminal — they call the scripts directly.

## Quick Start

```text
"onboard me"                  — Phase 0 calibration + Phase 1 product context intake
"load my project context"     — reads memory, builds context brief for the current session
"save the product description" — persists a confirmed fact to project-scoped memory
```

## Prerequisites

- Node.js 18+
- `npx tsx` (downloaded automatically on first run)
- `modules/web` running at `MEMORY_API_BASE` (default: `http://localhost:3000`)

Three environment variables must be set in the agent's session:

| Variable | Required | Purpose |
|----------|----------|---------|
| `FEATBIT_PROJECT_KEY` | Always | Scopes all reads and writes to the current FeatBit project |
| `FEATBIT_USER_ID` | For user-scope calls | Identifies the user for calibration and user-scoped memory |
| `MEMORY_API_BASE` | Optional | Override base URL of the web module (default: `http://localhost:3000`) |

Run `scripts/setup.sh` to verify your environment.

## What's Inside

```text
skills-project/
  product-context-elicitation/
    SKILL.md                    — two-phase intake: user calibration + product context
  project-memory-read/
    SKILL.md                    — reads project and user memory via scripts
  project-memory-write/
    SKILL.md                    — upserts or deletes a single memory entry
  scripts/
    memory-read.ts              — HTTP client: GET /api/memory/{project,user}/...
    memory-write.ts             — HTTP client: POST /api/memory/{project,user}/...
    memory-delete.ts            — HTTP client: DELETE /api/memory/{project,user}/...
    setup.sh                    — verifies Node.js + tsx availability
  _memory-schema.md             — Prisma table designs (ProjectMemory + UserProjectMemory)
```

The skills in this folder belong to **project-agent** (`modules/project-agent`). They are separate from the experiment-execution skills in `skills/` (`intent-shaping`, `hypothesis-design`, `experiment-workspace`, etc.) which belong to sandbox agents. The two skill sets have different lifecycles, different owners, and different activation surfaces.

## License

Apache 2.0 — see [LICENSE](LICENSE) and the root [NOTICE](../NOTICE) for attribution requirements.

---

Crafted with [Readme Craft](https://github.com/motiful/readme-craft)

[license-shield]: https://img.shields.io/badge/License-Apache_2.0-blue.svg
[license-url]: LICENSE
[version-shield]: https://img.shields.io/badge/version-0.2.0-blue.svg
[version-url]: product-context-elicitation/SKILL.md
[skills-shield]: https://img.shields.io/badge/Agent%20Skills-compatible-DA7857?logo=anthropic
[skills-url]: https://agentskills.io
