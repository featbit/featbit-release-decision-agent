import type { Response } from "express";
import { query } from "@anthropic-ai/claude-agent-sdk";
import { initSseHeaders, sendSseEvent, closeSseStream } from "./sse.js";
import type { QueryRequestBody } from "./types.js";
import {
  projectIdToSessionId,
  isKnownSession,
  markSessionKnown,
} from "./session-id.js";

const DEFAULT_MAX_TURNS = 50;

/**
 * Run a single Claude agent query and stream all SDK messages back to
 * the HTTP client via SSE.
 *
 * The agent uses `settingSources: ["project"]` so that any .claude/
 * directory alongside this server (skills, CLAUDE.md, settings) is
 * automatically loaded.
 */
export async function runAgentStream(
  body: QueryRequestBody & { prompt: string },
  res: Response,
  abortController: AbortController
): Promise<void> {
  initSseHeaders(res);

  const {
    prompt,
    projectId,
    maxTurns = DEFAULT_MAX_TURNS,
    allowedTools = ["Bash", "Read", "Write", "Edit", "Glob", "Grep", "WebFetch", "WebSearch", "Skill"],
    cwd = process.cwd(),
  } = body;

  // Derive a deterministic UUID from the projectId
  const pid = projectId ?? process.env.FEATBIT_PROJECT_ID ?? "default";
  const sessionUuid = projectIdToSessionId(pid);
  const resuming = isKnownSession(sessionUuid);

  try {
    console.log("[agent] Starting query with prompt:", prompt.slice(0, 80));
    console.log(`[agent] projectId="${pid}" sessionUuid=${sessionUuid} resuming=${resuming}`);

    const agentQuery = query({
      prompt,
      options: {
        abortController,
        cwd,
        maxTurns,
        allowedTools,
        includePartialMessages: true,
        settingSources: ["user", "project"],
        systemPrompt: { type: "preset", preset: "claude_code" },
        // New session → set the UUID; resumed session → resume it
        ...(resuming ? { resume: sessionUuid } : { sessionId: sessionUuid }),
      },
    });

    // Mark session as known so subsequent calls resume instead of create
    markSessionKnown(sessionUuid);

    let messageCount = 0;
    for await (const message of agentQuery) {
      messageCount++;
      console.log(`[agent] Message #${messageCount} type=${message.type}`);
      if (abortController.signal.aborted) break;

      const type = message.type;

      if (type === "stream_event") {
        sendSseEvent(res, "stream_event", message);
      } else if (type === "assistant") {
        sendSseEvent(res, "message", message);
      } else if (type === "result") {
        sendSseEvent(res, "result", message);
      } else if (type === "tool_progress") {
        sendSseEvent(res, "tool_progress", message);
      } else {
        // system, compact_boundary, rate_limit_event, etc.
        sendSseEvent(res, "system", message);
      }
    }

    console.log(`[agent] Stream finished. Total messages: ${messageCount}`);
  } catch (err: unknown) {
    console.error("[agent] Error:", err);
    if (!abortController.signal.aborted) {
      const message = err instanceof Error ? err.message : String(err);
      sendSseEvent(res, "error", { message });
    }
  } finally {
    closeSseStream(res);
  }
}
