import { Router } from "express";
import type { Request, Response } from "express";
import { randomUUID } from "crypto";
import { runAgentStream } from "../agent.js";
import { registerSession, removeSession, getSession, listSessions } from "../session-store.js";
import type { QueryRequestBody } from "../types.js";
import { buildEffectivePrompt } from "../prompt.js";

const router = Router();

/**
 * POST /query — start a streaming agent run.
 *
 * SSE events emitted:
 *   stream_event  – partial text/tool deltas
 *   message       – full assistant turn
 *   result        – final result summary
 *   system        – status / boundary / system message
 *   tool_progress – tool execution updates
 *   error         – { message: string }
 *   done          – {} (stream finished)
 */
router.post("/", async (req: Request, res: Response) => {
  const body = req.body as QueryRequestBody;

  if (body.prompt !== undefined && typeof body.prompt !== "string") {
    res.status(400).json({ error: "prompt must be a string when provided" });
    return;
  }

  const effectivePrompt = buildEffectivePrompt(body);

  const serverId = randomUUID();
  const abortController = new AbortController();

  registerSession({
    sessionId: serverId,
    abortController,
    startedAt: Date.now(),
  });

  res.setHeader("X-Session-Id", serverId);

  res.socket?.on("error", (err: NodeJS.ErrnoException) => {
    if (err.code === "EPIPE" || err.code === "ECONNRESET") return;
    console.error("[sse] Socket error:", err);
  });

  let streamDone = false;

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

/** GET /query/sessions — list active sessions on this connector. */
router.get("/sessions", (_req: Request, res: Response) => {
  const active = listSessions().map(({ sessionId, startedAt }) => ({
    sessionId,
    startedAt,
    runningMs: Date.now() - startedAt,
  }));
  res.json({ sessions: active });
});

/** DELETE /query/sessions/:id — abort a running session. */
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
