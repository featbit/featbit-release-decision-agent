# FeatBit Release Decision Console — Project Memory

## Project purpose

`sandbox0` is a **console frontend demo** that connects to the **Anthropic Claude Managed Agents**
service and drives the `featbit-release-decision` skill inside a managed agent session.

Unlike `agent/sandbox` (which uses the Claude Code SDK to run Claude locally), this project uses
the Managed Agents REST API (`/v1/agents`, `/v1/environments`, `/v1/sessions`) — the agent runs
in Anthropic-hosted infrastructure.

## Key directories

| Path | Purpose |
|---|---|
| `src/index.ts` | Interactive console REPL — main entry point |
| `src/client.ts` | Anthropic SDK client singleton |
| `src/skill-loader.ts` | Reads SKILL.md + references, composes agent system prompt |
| `src/agent-setup.ts` | Creates / loads managed agent + environment; persists `.agent-config.json` |
| `src/session.ts` | Session lifecycle: create, bootstrap, send messages, open stream |
| `src/stream.ts` | SSE event stream processing + console rendering |
| `src/ui.ts` | Chalk-based console display helpers |
| `scripts/setup-agent.ts` | One-time bootstrap: `npm run setup` |

## How skills work in Managed Agents

The Claude Code SDK has a `~/.claude/skills/` loader. Managed Agents have no such mechanism.

**Bridge pattern used here:**

1. `skill-loader.ts` reads `skills/featbit-release-decision/SKILL.md` (+ references) at **setup time**
2. The content is composed into the agent's **system prompt** via `client.beta.agents.create()`
3. The system prompt also contains a **Project Sync HTTP API bridge** — translating
   `sync.ts` CLI commands into direct `curl` calls the agent can execute via bash
4. At session start, a **bootstrap message** injects `PROJECT_ID` and `SYNC_API_URL`
   so the agent knows which project to work on and where the web DB lives

## Conventions

- All source files use ES module syntax (`import`/`export`).
- Agent config (IDs) is persisted to `.agent-config.json` (gitignored).
- Env vars in `.env` can override `.agent-config.json` (`MANAGED_AGENT_ID`, `MANAGED_ENVIRONMENT_ID`).
- The beta header `managed-agents-2026-04-01` is set automatically by `@anthropic-ai/sdk`.

## First-time setup

```bash
cp .env.example .env        # fill in ANTHROPIC_API_KEY
npm install
npm run setup               # creates agent + environment, saves .agent-config.json
npm run dev                 # start interactive console
```
