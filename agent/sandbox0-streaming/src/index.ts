/**
 * index.ts — sandbox0-streaming
 *
 * SSE proxy between Claude Managed Agents and the FeatBit web client.
 *
 * Routes
 * ──────
 *   GET  /health   health check
 *   POST /query    receive { projectId, prompt? } → relay CMA SSE to browser
 *
 * SSE event format (passed through unchanged from CMA):
 *   event: agent.message          → text content from the agent
 *   event: agent.tool_use         → tool call in progress
 *   event: agent.tool_result      → tool call result
 *   event: session.status_idle    → agent finished; stream closed
 *   event: session.status_terminated → unrecoverable error
 *   event: session.error          → transient error (may auto-retry)
 *   event: error                  → proxy-level error
 */

import "dotenv/config";
import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { streamSSE } from "hono/streaming";
import {
  resolveSession,
  buildBootstrapMessage,
  sendMessage,
  openStream,
} from "./session.js";
import { clearSandboxSession } from "./db.js";

const app = new Hono();

// Allow the web client (any origin in dev, lock down in prod via env)
app.use(
  "*",
  cors({
    origin: process.env.CORS_ORIGIN ?? "*",
    allowMethods: ["GET", "POST", "OPTIONS"],
    allowHeaders: ["Content-Type"],
  }),
);

// ── Health ────────────────────────────────────────────────────────────────────

app.get("/health", (c) => c.json({ status: "ok" }));

// ── Query (SSE stream) ────────────────────────────────────────────────────────

app.post("/query", async (c) => {
  const body = await c.req.json<{ projectId?: string; prompt?: string }>().catch(() => ({}));
  const experimentId = body.projectId?.trim();

  if (!experimentId) {
    return c.json({ error: "projectId is required" }, 400);
  }

  return streamSSE(c, async (stream) => {
    const writeEvent = (event: string, data: unknown) =>
      stream.writeSSE({ event, data: JSON.stringify(data) });

    try {
      // 1. Resolve (or create) CMA session
      const sessionInfo = await resolveSession(experimentId);
      const prompt = body.prompt?.trim();

      // 2. Send message to the CMA session
      if (sessionInfo.isNew) {
        // Brand-new session: activate the skill via bootstrap
        await sendMessage(sessionInfo.sessionId, buildBootstrapMessage(sessionInfo, experimentId));
      } else if (prompt) {
        // Existing session: forward the user message
        await sendMessage(sessionInfo.sessionId, prompt);
      }
      // Empty prompt + existing session: just re-attach to the stream (no message needed)

      // 3. Open CMA event stream and relay every event to the browser
      const cmaStream = await openStream(sessionInfo.sessionId);

      for await (const event of cmaStream) {
        if (stream.closed) break;

        const type: string = event?.type ?? "";
        await writeEvent(type, event);

        if (type === "session.status_idle") break;

        if (type === "session.status_terminated") {
          // Session is dead — clear the DB entry so next request starts fresh
          await clearSandboxSession(experimentId).catch(() => {});
          break;
        }
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      await writeEvent("error", { message }).catch(() => {});
    }
  });
});

// ── Start ─────────────────────────────────────────────────────────────────────

const port = parseInt(process.env.PORT ?? "3100", 10);
serve({ fetch: app.fetch, port }, () => {
  console.log(`sandbox0-streaming  →  http://localhost:${port}`);
});
