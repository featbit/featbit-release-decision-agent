import type { Response } from "express";
import { query } from "@anthropic-ai/claude-agent-sdk";
import { initSseHeaders, sendSseEvent, closeSseStream } from "./sse.js";
import type { QueryRequestBody } from "./types.js";
import { projectIdToSessionId } from "./session-id.js";
import { buildEffectivePrompt } from "./prompt.js";

const DEFAULT_MAX_TURNS = 50;

type PermissionMode = "default" | "acceptEdits" | "bypassPermissions" | "plan";

/**
 * Pick the SDK permission mode. The connector runs headless (no TTY), so
 * the SDK's default mode would block forever waiting for an interactive
 * approval that nobody can answer. Default to `bypassPermissions` because
 * the connector is loopback-only and runs on the user's own machine — the
 * trust boundary is identical to running `claude --dangerously-skip-permissions`.
 *
 * Set `PERMISSION_MODE=default|acceptEdits|plan` to tighten if you want
 * tool-level approvals (you will need to wire your own approval mechanism;
 * the SDK's built-in TTY prompt cannot reach this process).
 */
function resolvePermissionMode(): PermissionMode {
  const raw = process.env.PERMISSION_MODE?.trim();
  if (
    raw === "default" ||
    raw === "acceptEdits" ||
    raw === "bypassPermissions" ||
    raw === "plan"
  ) {
    return raw;
  }
  return "bypassPermissions";
}

const PERMISSION_MODE = resolvePermissionMode();

/**
 * Stream a Claude Code agent run back to the web client over SSE.
 *
 * Session create-vs-resume is decided from the prompt intent (bootstrap →
 * create, continuation → resume). On failure the modes are flipped once,
 * so the SDK's `~/.claude/projects/<cwd>/<uuid>.jsonl` is the only source
 * of truth.
 *
 * Tool permissions deliberately come from the user's `~/.claude/settings.json`
 * (loaded via `settingSources: ["user", "project"]`) — no default allowlist
 * is injected here, since this runs on the user's own machine.
 */
export async function runAgentStream(
  body: QueryRequestBody,
  effectivePrompt: ReturnType<typeof buildEffectivePrompt>,
  res: Response,
  abortController: AbortController,
): Promise<void> {
  initSseHeaders(res);

  const { maxTurns = DEFAULT_MAX_TURNS, allowedTools, cwd = process.cwd() } = body;

  const experimentId =
    body.experimentId ?? body.projectId ?? process.env.FEATBIT_PROJECT_ID ?? "default";
  const sessionUuid = projectIdToSessionId(experimentId);

  const baseOptions = {
    abortController,
    cwd,
    maxTurns,
    ...(allowedTools ? { allowedTools } : {}),
    permissionMode: PERMISSION_MODE,
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
      // The SDK sometimes surfaces protocol-level errors (e.g. "No
      // conversation found with session ID") as a `result` event with
      // is_error=true instead of throwing. Treat that as a thrown error
      // before any user-visible data so the outer retry can flip modes.
      if (
        !hasStreamedData &&
        message.type === "result" &&
        (message as { is_error?: boolean }).is_error === true
      ) {
        const errs = (message as { errors?: string[] }).errors ?? [];
        throw new Error(errs[0] ?? "Agent returned error result before streaming");
      }

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

  const startResume = !effectivePrompt.isBootstrap;

  try {
    await doStream(effectivePrompt.prompt, startResume);
  } catch (err: unknown) {
    if (!hasStreamedData && !abortController.signal.aborted) {
      const flipResume = !startResume;
      console.log(
        `[agent] ${startResume ? "Resume" : "Create"} failed, retrying as ${flipResume ? "resume" : "create"}`,
      );

      // When falling back from resume→create for a non-bootstrap prompt,
      // prepend the skill slash command so the new session loads project
      // context before answering the user.
      let retryPrompt = effectivePrompt.prompt;
      if (!flipResume && !effectivePrompt.isBootstrap) {
        const bootstrap = buildEffectivePrompt({ ...body, prompt: "" });
        retryPrompt = `${bootstrap.prompt}\n\n${effectivePrompt.prompt}`;
      }

      try {
        await doStream(retryPrompt, flipResume);
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
