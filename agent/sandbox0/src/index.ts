/**
 * index.ts — FeatBit Release Decision Console
 *
 * Interactive REPL connecting to Claude Managed Agents.
 * Sessions are persisted to .sessions.json — restarting the console resumes
 * the same conversation context for each project.
 *
 * Commands during the session:
 *   /quit  or  /exit       — end the console
 *   /new                   — force a fresh session (discard saved)
 *   /project <id>          — switch to a different project
 *   /sessions              — list all stored sessions
 *   /stop  or  Ctrl+C      — interrupt the agent while it is running
 */

import "dotenv/config";
import * as readline from "readline";
import { ui } from "./ui.js";
import { ensureAgentConfig } from "./agent-setup.js";
import {
  getOrCreateSession,
  createSession,
  buildBootstrapMessage,
  sendMessage,
  sendInterrupt,
  openStream,
} from "./session.js";
import { clearSession, listSessions } from "./session-store.js";

// ── Helpers ───────────────────────────────────────────────────────────────────

function createReadline(): readline.Interface {
  return readline.createInterface({ input: process.stdin, terminal: false });
}

function askLine(rl: readline.Interface): Promise<string | null> {
  return new Promise((resolve) => {
    rl.once("line", (line) => resolve(line));
    rl.once("close", () => resolve(null));
  });
}

/**
 * Run processStream while also listening for /stop or Ctrl+C.
 * Either input sends user.interrupt and lets the stream finish naturally
 * (the agent will emit session.status_idle with stop_reason "interrupted").
 */
async function streamWithInterrupt(
  sessionId: string,
  stream: AsyncIterable<any>,
  rl: readline.Interface,
): Promise<ReturnType<typeof import("./stream.js").processStream>> {
  let interrupted = false;

  const interrupt = async () => {
    if (interrupted) return;
    interrupted = true;
    ui.warn("\nInterrupting agent...");
    try {
      await sendInterrupt(sessionId);
    } catch {
      // ignore — the stream will time out or terminate anyway
    }
  };

  // Listen for /stop typed while agent is running
  const onLine = (line: string) => {
    if (line.trim() === "/stop") interrupt();
  };
  rl.on("line", onLine);

  // Listen for Ctrl+C
  const onSigint = () => interrupt();
  process.once("SIGINT", onSigint);

  const { processStream } = await import("./stream.js");
  const result = await processStream(stream);

  rl.off("line", onLine);
  process.off("SIGINT", onSigint);

  return result;
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  ui.banner();

  let agentConfig;
  try {
    agentConfig = await ensureAgentConfig();
  } catch (err) {
    ui.error(String(err));
    ui.info("Run `npm run setup` to create the managed agent and environment first.");
    process.exit(1);
  }

  ui.info(`Agent:       ${agentConfig.agentId}`);
  ui.info(`Environment: ${agentConfig.environmentId}`);

  let projectId = process.env.FEATBIT_PROJECT_ID ?? "default";
  ui.info(`Project:     ${projectId}`);
  ui.separator();

  const rl = createReadline();

  // ── Establish session (resume or create) ─────────────────────────────────
  let handle = await getOrCreateSession(
    agentConfig.agentId,
    agentConfig.environmentId,
    projectId,
  );

  if (handle.isNew) {
    ui.success(`New session:      ${handle.sessionId}`);
    ui.info("Bootstrapping session with project context...");
    const stream = await openStream(handle.sessionId);
    await sendMessage(handle.sessionId, buildBootstrapMessage(handle));
    await streamWithInterrupt(handle.sessionId, stream, rl);
  } else {
    ui.success(`Resumed session:  ${handle.sessionId}`);
    ui.info("Continuing previous conversation. Type to continue.");
  }

  ui.info('\nCommands: /quit  /new  /project <id>  /sessions  /stop');

  // ── Interactive loop ──────────────────────────────────────────────────────
  while (true) {
    ui.prompt();
    const line = await askLine(rl);
    if (line === null) break;

    const input = line.trim();
    if (!input) continue;

    // ── Console commands ────────────────────────────────────────────────────
    if (input === "/quit" || input === "/exit") {
      ui.info("Goodbye.");
      break;
    }

    if (input === "/sessions") {
      const all = listSessions();
      const entries = Object.entries(all);
      if (entries.length === 0) {
        ui.info("No stored sessions.");
      } else {
        ui.header("Stored sessions:");
        for (const [pid, entry] of entries) {
          ui.info(`  ${pid}  →  ${entry.sessionId}  (last active: ${entry.lastActiveAt})`);
        }
      }
      continue;
    }

    if (input === "/stop") {
      ui.warn("Agent is not running. /stop only works while the agent is responding.");
      continue;
    }

    if (input === "/new") {
      ui.info("Starting a fresh session (discarding saved)...");
      clearSession(projectId);
      handle = await createSession(
        agentConfig.agentId,
        agentConfig.environmentId,
        projectId,
      );
      ui.success(`New session: ${handle.sessionId}`);
      const stream = await openStream(handle.sessionId);
      await sendMessage(handle.sessionId, buildBootstrapMessage(handle));
      await streamWithInterrupt(handle.sessionId, stream, rl);
      continue;
    }

    if (input.startsWith("/project ")) {
      projectId = input.slice(9).trim();
      if (!projectId) { ui.warn("Usage: /project <project-id>"); continue; }
      ui.info(`Switching to project: ${projectId}`);
      handle = await getOrCreateSession(
        agentConfig.agentId,
        agentConfig.environmentId,
        projectId,
      );
      if (handle.isNew) {
        ui.success(`New session: ${handle.sessionId}`);
        const stream = await openStream(handle.sessionId);
        await sendMessage(handle.sessionId, buildBootstrapMessage(handle));
        await streamWithInterrupt(handle.sessionId, stream, rl);
      } else {
        ui.success(`Resumed session: ${handle.sessionId}`);
      }
      continue;
    }

    // ── Regular message ─────────────────────────────────────────────────────
    try {
      const stream = await openStream(handle.sessionId);
      await sendMessage(handle.sessionId, input);
      const result = await streamWithInterrupt(handle.sessionId, stream, rl);
      if (!result.done) {
        ui.warn("Session terminated. Type /new to restart.");
      }
    } catch (err) {
      ui.error(`Error: ${String(err)}`);
      ui.info("Type /new to start a fresh session.");
    }
  }

  rl.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
