import type { Response } from "express";
import { query } from "@anthropic-ai/claude-agent-sdk";
import { initSseHeaders, sendSseEvent, closeSseStream } from "./sse.js";
import type { QueryRequestBody } from "./types.js";
import { projectIdToSessionId } from "./session-id.js";
import { buildEffectivePrompt } from "./prompt.js";

const DEFAULT_MAX_TURNS = 50;

/**
 * Run a single Claude agent query and stream all SDK messages back to
 * the HTTP client via SSE.
 *
 * Stateless session handling:
 *   - Bootstrap (empty user prompt → slash command): start in CREATE mode.
 *     If create fails (SDK already has this session UUID), retry in RESUME
 *     mode with the same slash command.
 *   - Continuation (non-empty user prompt): start in RESUME mode.
 *     If resume fails (SDK has no such session), retry in CREATE mode with
 *     the same user prompt.
 *
 * The SDK's own `~/.claude/projects/<cwd>/<uuid>.jsonl` is the sole source
 * of truth for session existence. No shadow state is maintained here.
 */
export async function runAgentStream(
  body: QueryRequestBody,
  effectivePrompt: ReturnType<typeof buildEffectivePrompt>,
  res: Response,
  abortController: AbortController
): Promise<void> {
  initSseHeaders(res);

  const {
    maxTurns = DEFAULT_MAX_TURNS,
    allowedTools = ["Bash", "Read", "Write", "Edit", "Glob", "Grep", "WebFetch", "WebSearch", "Skill"],
    cwd = process.cwd(),
  } = body;

  const experimentId =
    body.experimentId ?? body.projectId ?? process.env.FEATBIT_PROJECT_ID ?? "default";
  const sessionUuid = projectIdToSessionId(experimentId);

  const baseOptions = {
    abortController,
    cwd,
    maxTurns,
    allowedTools,
    includePartialMessages: true,
    settingSources: ["user" as const, "project" as const],
    systemPrompt: { type: "preset" as const, preset: "claude_code" as const },
  };

  let hasStreamedData = false;

  const doStream = async (prompt: string, resume: boolean) => {
    console.log(`[agent] experimentId="${experimentId}" sessionUuid=${sessionUuid} resume=${resume}`);
    console.log(`[agent] prompt: ${prompt.slice(0, 80)}`);

    const agentQuery = query({
      prompt,
      options: {
        ...baseOptions,
        ...(resume ? { resume: sessionUuid } : { sessionId: sessionUuid }),
      },
    });

    let messageCount = 0;
    for await (const message of agentQuery) {
      if (!hasStreamedData) hasStreamedData = true;
      messageCount++;
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
        sendSseEvent(res, "system", message);
      }
    }

    console.log(`[agent] Stream finished. Total messages: ${messageCount}`);
  };

  // Pick the starting mode from intent, not from persisted state.
  const startResume = !effectivePrompt.isBootstrap;

  try {
    await doStream(effectivePrompt.prompt, startResume);
  } catch (err: unknown) {
    if (!hasStreamedData && !abortController.signal.aborted) {
      const flipResume = !startResume;
      console.log(
        `[agent] ${startResume ? "Resume" : "Create"} failed, retrying as ${flipResume ? "resume" : "create"}`
      );
      try {
        await doStream(effectivePrompt.prompt, flipResume);
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
