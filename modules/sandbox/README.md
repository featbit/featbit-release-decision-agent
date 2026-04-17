# Claude Agent SDK Server

A TypeScript Express server that bridges external HTTP clients with the Claude Agent SDK over **Server-Sent Events (SSE)**. External services send a prompt via HTTP POST and receive real-time streaming responses as the agent works — including partial text deltas, tool progress, and final results.

## Features

- Real-time SSE streaming of agent output (`stream_event`, `message`, `result`, `tool_progress`, `system`, `error`, `done`)
- Session management: list and abort in-flight agent sessions
- Agent skills for reading local JSON data and calling external REST APIs
- Procedural TypeScript throughout — no classes, ES module imports

## Project Structure

```
src/
  agent.ts          # Core runner — calls SDK, maps messages to SSE events
  sse.ts            # SSE helpers (initSseHeaders, sendSseEvent, closeSseStream)
  session-store.ts  # In-memory session registry
  types.ts          # Shared TypeScript types
  server.ts         # Express app entry point
  routes/
    query.ts        # POST /query, GET /query/sessions, DELETE /query/sessions/:id
scripts/
  read-data.ts      # Read a JSON file from data/ (invoked by agent via Bash)
  call-api.ts       # Make an HTTP request to an external API (invoked by agent via Bash)
data/
  sample.json       # Sample feature-flag records for demo/testing
.claude/
  settings.json     # Agent permission rules
  skills/
    read-local-data/SKILL.md   # Skill: read data/ JSON files
    call-remote-api/SKILL.md   # Skill: call external REST APIs
CLAUDE.md           # Project memory loaded by the agent automatically
```

## Prerequisites

- Node.js 20+
- An [Anthropic API key](https://console.anthropic.com/)

## Setup

```bash
npm install
cp .env.example .env   # then fill in ANTHROPIC_API_KEY
```

## Running

```bash
# Development (hot-reload via tsx watch)
npm run dev

# Production
npm run build
npm start
```

The server starts on `http://localhost:3000` (or `PORT` from `.env`).

## API

### `POST /query` — Start an agent session (SSE stream)

**Request body:**

```json
{
  "projectId": "681e90cf-fdf5-4c57-8a8d-a15274ffe40f",
  "maxTurns": 10,
  "allowedTools": ["Bash", "Read"],
  "cwd": "/optional/working/directory"
}
```

For a brand-new release-decision session, `prompt` is optional. The server will send the slash command automatically from `projectId` and `accessToken`.

For later turns on the same session, send a normal user `prompt`.

Example follow-up turn:

```json
{
  "projectId": "681e90cf-fdf5-4c57-8a8d-a15274ffe40f",
  "prompt": "We want to improve activation on the first-run page.",
  "maxTurns": 10
}
```

**Response:** `text/event-stream` — each SSE event has the form:

```
event: <event-name>
data: <json-payload>
```

| Event name | When sent | Payload |
|---|---|---|
| `stream_event` | Text delta (partial assistant message) | `SDKPartialAssistantMessage` |
| `message` | Complete assistant turn | `SDKAssistantMessage` |
| `result` | Final agent result | `SDKResultMessage` |
| `tool_progress` | Tool invocation update | `SDKToolUseMessage / SDKToolResultMessage` |
| `system` | System messages | `SDKSystemMessage` |
| `error` | Runtime error | `{ message: string }` |
| `done` | Stream closed | `{}` |

The response header `X-Session-Id` contains the session ID for subsequent management calls.

### `GET /query/sessions` — List active sessions

Returns a JSON array of `{ sessionId, startedAt }` objects.

### `DELETE /query/sessions/:id` — Abort a session

Sends an abort signal to the running agent. Returns `204` when found, `404` otherwise.

### `GET /health` — Health check

Returns `{ status: "ok" }`.

## Environment Variables

| Variable | Required | Description |
|---|---|---|
| `ANTHROPIC_API_KEY` | Yes | Anthropic API key |
| `PORT` | No (default `3000`) | HTTP listen port |
| `CORS_ORIGINS` | No | Comma-separated allowed origins |
| `API_KEY` | No | Bearer token forwarded by `scripts/call-api.ts` |

## Agent Skills

The agent automatically loads skills from `.claude/skills/`:

- **read-local-data** — Lists and reads JSON files from `data/` using `tsx scripts/read-data.ts`
- **call-remote-api** — Makes HTTP requests to external APIs using `tsx scripts/call-api.ts`

