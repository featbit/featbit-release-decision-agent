/**
 * index.ts — sandbox0-streaming
 *
 * Routes
 * ──────
 *   GET  /              web chat UI
 *   GET  /health        health check
 *   POST /chat/start    create a new chat session → { sessionId }
 *   POST /chat/send     send message → { ok }
 *   GET  /chat/events   poll events  → { events[], done }
 *   POST /query         (legacy) experiment-based SSE proxy
 */

import "dotenv/config";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
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
import {
  clearSandboxSession,
  ensureManagedAgentTable,
  ensureVaultTable,
  getManagedAgent,
  getVault,
} from "./db.js";
import {
  createChatSession,
  sendChatMessage,
  getSessionStatus,
  getSessionEvents,
} from "./chat.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

const app = new Hono();

app.use(
  "*",
  cors({
    origin: process.env.CORS_ORIGIN ?? "*",
    allowMethods: ["GET", "POST", "OPTIONS"],
    allowHeaders: ["Content-Type"],
  }),
);

// ── Static UI ────────────────────────────────────────────────────────────────

const htmlPath = resolve(__dirname, "../public/index.html");

app.get("/", (c) => c.html(readFileSync(htmlPath, "utf-8")));

// ── Health ───────────────────────────────────────────────────────────────────

app.get("/health", (c) => c.json({ status: "ok" }));

// ── Chat API ─────────────────────────────────────────────────────────────────

app.post("/chat/start", async (c) => {
  await ensureManagedAgentTable();
  await ensureVaultTable();

  const version = process.env.MANAGED_AGENT_VERSION ?? "default";
  const agent = await getManagedAgent(version);
  if (!agent) {
    return c.json({ error: `No managed agent for version "${version}"` }, 500);
  }

  const llmVault = await getVault("llm");
  const vaultIds = llmVault ? [llmVault.vaultId] : [];

  const session = await createChatSession(
    agent.agentId,
    agent.environmentId,
    vaultIds,
  );

  // Send bootstrap message to activate the release-decision skill
  await sendChatMessage(
    session.sessionId,
    `/featbit-release-decision\n\nActivate the FeatBit Release Decision framework. Greet the user and ask what they want to improve or learn.`,
  );

  return c.json({ sessionId: session.sessionId });
});

app.post("/chat/send", async (c) => {
  const { sessionId, message } = await c.req.json<{
    sessionId: string;
    message: string;
  }>();

  if (!sessionId || !message) {
    return c.json({ error: "sessionId and message are required" }, 400);
  }

  await sendChatMessage(sessionId, message);
  return c.json({ ok: true });
});

app.get("/chat/events", async (c) => {
  const sessionId = c.req.query("sessionId");
  const afterId = c.req.query("afterId");

  if (!sessionId) {
    return c.json({ error: "sessionId is required" }, 400);
  }

  const [status, events] = await Promise.all([
    getSessionStatus(sessionId),
    getSessionEvents(sessionId, afterId || undefined),
  ]);

  const done = status === "idle" || status === "terminated";
  return c.json({ events, status, done });
});

// ── Legacy Query (SSE stream) ────────────────────────────────────────────────

app.post("/query", async (c) => {
  const body = await c.req
    .json<{ projectId?: string; prompt?: string }>()
    .catch(() => ({}));
  const experimentId = body.projectId?.trim();

  if (!experimentId) {
    return c.json({ error: "projectId is required" }, 400);
  }

  return streamSSE(c, async (stream) => {
    const writeEvent = (event: string, data: unknown) =>
      stream.writeSSE({ event, data: JSON.stringify(data) });

    try {
      const sessionInfo = await resolveSession(experimentId);
      const prompt = body.prompt?.trim();

      if (sessionInfo.isNew) {
        await sendMessage(
          sessionInfo.sessionId,
          buildBootstrapMessage(sessionInfo, experimentId),
        );
      } else if (prompt) {
        await sendMessage(sessionInfo.sessionId, prompt);
      }

      const cmaStream = await openStream(sessionInfo.sessionId);

      for await (const event of cmaStream) {
        if (stream.closed) break;

        const type: string = event?.type ?? "";
        await writeEvent(type, event);

        if (type === "session.status_idle") break;
        if (type === "session.status_terminated") {
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

// ── Start ────────────────────────────────────────────────────────────────────

const port = parseInt(process.env.PORT ?? "3100", 10);
serve({ fetch: app.fetch, port }, () => {
  console.log(`sandbox0-streaming  →  http://localhost:${port}`);
});
