import type { Response } from "express";
import { query } from "@anthropic-ai/claude-agent-sdk";
import { initSseHeaders, sendSseEvent, closeSseStream } from "./sse.js";
import type { QueryRequestBody } from "./types.js";
import {
  projectIdToSessionId,
  isKnownSession,
  markSessionKnown,
  unmarkSession,
} from "./session-id.js";
import { buildEffectivePrompt } from "./prompt.js";

const DEFAULT_MAX_TURNS = 50;

/**
 * Run a single Claude agent query and stream all SDK messages back to
 * the HTTP client via SSE.
 *
 * Includes retry logic: if the first attempt fails before any data is
 * streamed (e.g. resume/create mismatch after restart or session store
 * corruption), the opposite session mode is tried once.
 */
export async function runAgentStream(
  body: QueryRequestBody,
  effectivePrompt: string,
  res: Response,
  abortController: AbortController
): Promise<void> {
  initSseHeaders(res);

  const {
    projectId: rawProjectId,
    maxTurns = DEFAULT_MAX_TURNS,
    allowedTools = ["Bash", "Read", "Write", "Edit", "Glob", "Grep", "WebFetch", "WebSearch", "Skill"],
    cwd = process.cwd(),
  } = body;

  const pid = rawProjectId ?? process.env.FEATBIT_PROJECT_ID ?? "default";
  const sessionUuid = projectIdToSessionId(pid);
  let resuming = isKnownSession(sessionUuid);

  const baseOptions = {
    abortController,
    cwd,
    maxTurns,
    allowedTools,
    includePartialMessages: true,
    settingSources: ["user", "project"],
    systemPrompt: { type: "preset", preset: "claude_code" },
  };

  let hasStreamedData = false;

  /** Stream a single query attempt and dispatch SSE events. */
  const doStream = async (prompt: string, isResuming: boolean) => {
    console.log("[agent] Starting query with prompt:", prompt.slice(0, 80));
    console.log(`[agent] projectId="${pid}" sessionUuid=${sessionUuid} resuming=${isResuming}`);

    const agentQuery = query({
      prompt,
      options: {
        ...baseOptions,
        ...(isResuming ? { resume: sessionUuid } : { sessionId: sessionUuid }),
      },
    });

    let messageCount = 0;
    for await (const message of agentQuery) {
      if (!hasStreamedData) {
        hasStreamedData = true;
        markSessionKnown(sessionUuid);
      }
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
  };

  try {
    await doStream(effectivePrompt, resuming);
  } catch (err: unknown) {
    if (!hasStreamedData && !abortController.signal.aborted) {
      // First attempt failed before any data was streamed.
      // Retry with the opposite session mode (resume ↔ create).
      const retryResuming = !resuming;
      const retryPrompt = buildEffectivePrompt(body, retryResuming);

      if (retryPrompt.trim() === "") {
        // Can't retry — no prompt available for this mode
        const message = err instanceof Error ? err.message : String(err);
        sendSseEvent(res, "error", { message });
        closeSseStream(res);
        return;
      }

      console.log(
        `[agent] ${resuming ? "Resume" : "Create"} failed, retrying with ${retryResuming ? "resume" : "create"} mode`
      );

      // If flipping to create, clear the persisted "known" flag
      if (!retryResuming) unmarkSession(sessionUuid);

      try {
        await doStream(retryPrompt, retryResuming);
      } catch (retryErr: unknown) {
        console.error("[agent] Retry also failed:", retryErr);
        if (!abortController.signal.aborted) {
          const message = retryErr instanceof Error ? retryErr.message : String(retryErr);
          sendSseEvent(res, "error", { message });
        }
      }
    } else {
      console.error("[agent] Error:", err);
      if (!abortController.signal.aborted) {
        const message = err instanceof Error ? err.message : String(err);
        sendSseEvent(res, "error", { message });
      }
    }
  } finally {
    closeSseStream(res);
  }
}
