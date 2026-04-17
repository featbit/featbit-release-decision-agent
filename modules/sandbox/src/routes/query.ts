import { Router } from "express";
import type { Request, Response } from "express";
import { randomUUID } from "crypto";
import { runAgentStream } from "../agent.js";
import { registerSession, removeSession, getSession, listSessions } from "../session-store.js";
import type { QueryRequestBody } from "../types.js";
import { buildEffectivePrompt } from "../prompt.js";

const router = Router();

/**
 * POST /query
 *
 * Starts a new agent query session. The response is an SSE stream.
 * The client should read `event: system` for the session init message
 * (which contains the real Claude session_id), then stream text via
 * `event: stream_event`, and await `event: result` for the final summary.
 *
 * Body: QueryRequestBody
 *
 * `prompt` is optional for a brand-new project session bootstrap. In that case
 * the server injects the release-decision slash command automatically.
 *
 * SSE events emitted:
 *   stream_event  – SDKPartialAssistantMessage (text/tool deltas)
 *   message       – SDKAssistantMessage (complete turn)
 *   result        – SDKResultMessage
 *   system        – SDKSystemMessage / status / boundary
 *   tool_progress – SDKToolProgressMessage
 *   error         – { message: string }
 *   done          – {} (stream finished)
 */
router.post("/", async (req: Request, res: Response) => {
  const body = req.body as QueryRequestBody;

  if (body.prompt !== undefined && typeof body.prompt !== "string") {
    res.status(400).json({ error: "prompt must be a string when provided" });
    return;
  }

  // For new sessions, prepend the initial skill command;
  // for resumed sessions, pass the user prompt as-is.
  const effectivePrompt = buildEffectivePrompt(body);
  if (effectivePrompt.trim() === "") {
    // Resumed session with no prompt — the client just wants to confirm
    // the session is alive (e.g. auto-init on mount). Return a lightweight
    // SSE ack instead of 400 to keep the UI happy.
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.write(`event: system\ndata: ${JSON.stringify({ type: "session_resumed", projectId: body.projectId ?? "default" })}\n\n`);
    res.write(`event: done\ndata: {}\n\n`);
    res.end();
    return;
  }

  const serverId = randomUUID();
  const abortController = new AbortController();

  registerSession({
    sessionId: serverId,
    abortController,
    startedAt: Date.now(),
  });

  // Attach our internal serverId as a response header so callers can
  // abort the session via DELETE /sessions/:id
  res.setHeader("X-Session-Id", serverId);

  // Prevent socket-level EPIPE from propagating
  res.socket?.on("error", (err: NodeJS.ErrnoException) => {
    if (err.code === "EPIPE" || err.code === "ECONNRESET") return;
    console.error("[sse] Socket error:", err);
  });

  // Track whether the stream ended naturally
  let streamDone = false;

  // Clean up when the *response* closes (client disconnect or normal end)
  res.on("close", () => {
    console.log(`[session:${serverId}] res close – streamDone=${streamDone}`);
    if (!streamDone) {
      abortController.abort();
    }
    removeSession(serverId);
  });

  await runAgentStream(body, effectivePrompt, res, abortController);
  streamDone = true;
  console.log(`[session:${serverId}] runAgentStream returned`);
  removeSession(serverId);
});

/**
 * GET /query/sessions
 * Returns a list of currently active (streaming) sessions.
 */
router.get("/sessions", (_req: Request, res: Response) => {
  const active = listSessions().map(({ sessionId, startedAt }) => ({
    sessionId,
    startedAt,
    runningMs: Date.now() - startedAt,
  }));
  res.json({ sessions: active });
});

/**
 * DELETE /query/sessions/:id
 * Aborts an active session by its server-assigned ID.
 */
router.delete("/sessions/:id", (req: Request, res: Response) => {
  const id = req.params.id as string;
  const session = getSession(id);
  if (!session) {
    res.status(404).json({ error: "session not found" });
    return;
  }
  session.abortController.abort();
  removeSession(id);
  res.json({ ok: true });
});

export default router;
