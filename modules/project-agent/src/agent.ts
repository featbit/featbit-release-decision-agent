import type { Response } from "express";
import { Codex } from "@openai/codex-sdk";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { initSseHeaders, sendSseEvent, closeSseStream } from "./sse.js";
import { buildPrompt } from "./prompt.js";
import {
  getThreadId,
  setThreadId,
  forgetThread,
  resolveSessionKey,
} from "./session-store.js";
import type { QueryRequestBody } from "./types.js";

const here = dirname(fileURLToPath(import.meta.url));
const moduleRoot = resolve(here, "..");

/**
 * Run a single turn against Codex, streaming every ThreadEvent as SSE.
 *
 * Session strategy:
 *   - A logical sessionKey (default "{projectKey}:{userId}") maps to a
 *     Codex thread id. If we have one, resume; otherwise start fresh and
 *     remember the assigned id from the `thread.started` event.
 *   - On an explicit recovery failure, forget the thread and retry once
 *     from a fresh start.
 */
export async function runAgentStream(
  body: QueryRequestBody,
  res: Response,
  abortController: AbortController
): Promise<void> {
  initSseHeaders(res);

  const projectKey =
    body.projectKey?.trim() || process.env.FEATBIT_PROJECT_KEY || "";
  const userId =
    body.userId?.trim() || process.env.FEATBIT_USER_ID || undefined;

  if (!projectKey) {
    sendSseEvent(res, "error", {
      message:
        "projectKey is required (request body or FEATBIT_PROJECT_KEY env).",
    });
    closeSseStream(res);
    return;
  }

  const userPrompt = body.prompt?.trim() ?? "";
  const isBootstrap = userPrompt.length === 0;
  const prompt = buildPrompt({ projectKey, userId, isBootstrap, userPrompt });
  const sessionKey = resolveSessionKey(projectKey, userId, body.sessionKey);

  const codex = new Codex({
    env: buildChildEnv(projectKey, userId),
  });

  const runOnce = async (fromScratch: boolean) => {
    const existingThreadId = fromScratch ? undefined : getThreadId(sessionKey);
    const thread = existingThreadId
      ? codex.resumeThread(existingThreadId, threadOptions())
      : codex.startThread(threadOptions());

    console.log(
      `[agent] sessionKey="${sessionKey}" resume=${!!existingThreadId} bootstrap=${isBootstrap}`
    );

    const { events } = await thread.runStreamed(prompt, {
      signal: abortController.signal,
    });

    for await (const event of events) {
      if (abortController.signal.aborted) break;

      switch (event.type) {
        case "thread.started":
          setThreadId(sessionKey, event.thread_id);
          sendSseEvent(res, "thread_started", event);
          break;
        case "turn.started":
          sendSseEvent(res, "turn_started", event);
          break;
        case "item.started":
          sendSseEvent(res, "item_started", event);
          break;
        case "item.updated":
          sendSseEvent(res, "item_updated", event);
          break;
        case "item.completed":
          sendSseEvent(res, "item_completed", event);
          break;
        case "turn.completed":
          sendSseEvent(res, "turn_completed", event);
          break;
        case "turn.failed":
          sendSseEvent(res, "turn_failed", event);
          break;
        case "error":
          sendSseEvent(res, "error", event);
          break;
        default:
          sendSseEvent(res, "system", event);
      }
    }
  };

  // Keep-alive: send SSE comment every 5 s while Codex is starting so the
  // browser does not close the connection before the first event arrives.
  const keepaliveTimer = setInterval(() => {
    if (!res.writableEnded) res.write(": keepalive\n\n");
  }, 5000);

  try {
    await runOnce(false);
  } catch (err) {
    // AbortError means the browser disconnected — nothing to report.
    const isAbort =
      abortController.signal.aborted ||
      (err instanceof Error && err.name === "AbortError");
    if (isAbort) {
      console.log(`[agent] request aborted: ${describeErr(err)}`);
    } else {
      // If resumption fails (thread vanished from ~/.codex/sessions, etc.),
      // drop the cached id and try a fresh start once.
      const hadCachedThread = !!getThreadId(sessionKey);
      if (hadCachedThread) {
        console.log(`[agent] resume failed, retrying from scratch: ${describeErr(err)}`);
        forgetThread(sessionKey);
        try {
          await runOnce(true);
        } catch (retryErr) {
          const retryAbort =
            abortController.signal.aborted ||
            (retryErr instanceof Error && retryErr.name === "AbortError");
          if (!retryAbort) {
            console.error("[agent] fresh-start retry also failed:", retryErr);
            sendSseEvent(res, "error", { message: describeErr(retryErr) });
          }
        }
      } else {
        console.error("[agent] error:", err);
        sendSseEvent(res, "error", { message: describeErr(err) });
      }
    }
  } finally {
    clearInterval(keepaliveTimer);
    closeSseStream(res);
  }
}

function threadOptions() {
  return {
    workingDirectory: moduleRoot,
    skipGitRepoCheck: true,
    sandboxMode: "workspace-write" as const,
    // Agent must be able to call /api/memory via fetch.
    networkAccessEnabled: true,
    // No human in the loop for automated approvals while iterating; revisit
    // for production deployment.
    approvalPolicy: "never" as const,
  };
}

function buildChildEnv(
  projectKey: string,
  userId: string | undefined
): Record<string, string> {
  // Codex's SDK replaces process.env entirely when env is provided — include
  // everything the child process needs (PATH is essential for the bundled
  // codex binary to invoke system tools).
  const base: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (typeof v === "string") base[k] = v;
  }
  base.FEATBIT_PROJECT_KEY = projectKey;
  if (userId) base.FEATBIT_USER_ID = userId;
  base.MEMORY_API_BASE =
    process.env.MEMORY_API_BASE ?? "http://localhost:3000";
  // Resolve CODEX_HOME to an absolute path so the Codex binary can find
  // config.toml regardless of its working directory at startup.
  base.CODEX_HOME = resolve(
    moduleRoot,
    process.env.CODEX_HOME ?? "codex-config"
  );
  // Codex binary writes session state to CODEX_HOME and also reads HOME.
  // System users created with --no-create-home (the default for --system)
  // have a HOME that doesn't exist on disk. Always point HOME at CODEX_HOME
  // so the binary has a guaranteed-writable location.
  base.HOME = base.CODEX_HOME;
  return base;
}

function describeErr(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}
