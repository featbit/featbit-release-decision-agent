# Claude Agent Server – Project Memory

## Project purpose
This is a TypeScript Express server that exposes the Claude Agent SDK over SSE
(Server-Sent Events) so that external programs can send prompts and receive
streaming responses in real-time.

## Key directories
- `src/`            – server source code
- `data/`           – local JSON data files readable by agent scripts
- `scripts/`        – Node.js helper scripts the agent can execute via Bash
- `.claude/skills/` – skill definitions (Markdown) loaded by the SDK

## Conventions
- All source files use ES module syntax (`import`/`export`), no `require`.
- Scripts in `scripts/` are plain `.ts` files runnable with `tsx`.
- Data files in `data/` are JSON; the agent may read but should not delete them.
- Remote API calls in skills must use environment variables for credentials
  (never hard-code secrets).

## Available skills
- `read-local-data`  – read and summarise JSON files from `data/`
- `call-remote-api`  – call an external REST API and return the response body
