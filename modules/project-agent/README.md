# project-agent

Project-level FeatBit AI. Handles first-run onboarding, captures product/user context into memory, and hands off to experiment skills when the user is ready to run a test.

Built on the [OpenAI Codex SDK](https://www.npmjs.com/package/@openai/codex-sdk). Exposes an SSE HTTP interface at `POST /query` identical in shape to `modules/sandbox`, so the web module can talk to both agents the same way.

## Layout

```
modules/project-agent/
├── AGENTS.md              ← always-on system prompt Codex reads at startup
├── package.json
├── tsconfig.json
├── .env.example
├── scripts/
│   ├── prepare-skills.ts  ← copies skills-project/ → ./skills/ pre-build
│   ├── memory-read.ts     ← (copied) HTTP client for GET /api/memory/…
│   ├── memory-write.ts    ← (copied) HTTP client for POST /api/memory/…
│   └── memory-delete.ts   ← (copied) HTTP client for DELETE /api/memory/…
├── skills/                ← (generated) mirror of ../../skills-project/
└── src/
    ├── server.ts          ← express app, mounts routes
    ├── routes/query.ts    ← POST /query — hands off to runAgentStream
    ├── agent.ts           ← Codex thread lifecycle + SSE streaming
    ├── prompt.ts          ← skill loader + bootstrap prompt builder
    ├── session-store.ts   ← in-memory sessionKey → threadId map
    ├── sse.ts             ← SSE helpers
    └── types.ts           ← request body + SSE event names
```

## Running locally

```bash
cp .env.example .env
# fill OPENAI_API_KEY and, if the web module runs elsewhere, MEMORY_API_BASE
npm install
npm run dev
```

Then, from another terminal, bootstrap a session:

```bash
curl -N -X POST http://localhost:3031/query \
  -H 'content-type: application/json' \
  -d '{"projectKey":"<some-featbit-project>","userId":"<featbit-user-id>"}'
```

An empty / absent `prompt` triggers the bootstrap flow (memory read + calibration check). Subsequent turns should send `{"prompt":"...","projectKey":"...","userId":"..."}` with the same `projectKey` + `userId` to resume the same Codex thread.

## What's deliberately out of scope for v1

- **Auth.** The HTTP surface is trusted. Put project-agent on the private network or add an agent token check before exposing publicly.
- **Multi-instance session store.** `session-store.ts` is in-process. Shard or migrate to Redis / Postgres before horizontal scaling.
- **Docker.** Dev-first. Containerise once the interaction model is settled.
