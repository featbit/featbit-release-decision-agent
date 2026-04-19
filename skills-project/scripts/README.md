# skills-project/scripts — reference helper scripts

These scripts are the **reference implementations** invoked by the skills in `skills-project/`. They are written in TypeScript, runnable with `tsx`, and wrap the `/api/memory` HTTP endpoints exposed by `modules/web`.

**Why reference, not canonical**: `skills-project/` is runtime-neutral. When `modules/project-agent/` is set up, it will copy (or symlink) these scripts into its own `scripts/` folder so the agent process can invoke them via Bash. Keeping them here makes the contract portable across agent runtimes.

## Environment variables

All scripts expect:

| Variable | Meaning | Default |
|---|---|---|
| `MEMORY_API_BASE` | Base URL of the web module's memory API | `http://localhost:3000` |
| `FEATBIT_PROJECT_KEY` | Current FeatBit project key | — (required) |
| `FEATBIT_USER_ID` | Current FeatBit user id | — (required for user-scope calls) |

The agent's SSE server should inject these per session, the same way `modules/sandbox` injects `FEATBIT_PROJECT_ID` / `FEATBIT_ACCESS_TOKEN`.

## Scripts

- `memory-read.ts` — list memory entries, optional type filter.
- `memory-write.ts` — upsert a single entry.
- `memory-delete.ts` — delete a single entry by key.
