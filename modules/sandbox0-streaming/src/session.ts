/**
 * session.ts
 *
 * Experiment-scoped CMA session lifecycle for sandbox0-streaming.
 *
 * Uses sandbox0's REST API directly (same shape as chat.ts) because the
 * installed @anthropic-ai/sdk does not expose beta.sessions yet.
 *
 * Flow per /query or /chat/start request:
 *   1. Look up experiment in DB → get sandboxId
 *   2. If sandboxId exists, verify it is still alive (GET /v1/sessions/{id})
 *   3. If dead or missing, create a new session and persist it
 *   4. Return SessionInfo so the caller can send a bootstrap + open the stream
 */

import {
  getExperiment,
  saveSandboxSession,
  getManagedAgent,
  getVault,
} from "./db.js";
import {
  createChatSession,
  sendChatMessage,
  getSessionStatus,
  getSessionEvents,
} from "./chat.js";

const BASE_URL = process.env.SANDBOX0_BASE_URL ?? "https://agents.sandbox0.ai";
const API_KEY = process.env.SANDBOX0_API_KEY ?? "";
const HEADERS: Record<string, string> = {
  "x-api-key": API_KEY,
  "anthropic-version": "2023-06-01",
  "anthropic-beta": "managed-agents-2026-04-01",
};

export interface SessionInfo {
  sessionId: string;
  /** true = brand-new session that needs a bootstrap message */
  isNew: boolean;
  /** FeatBit access token for this experiment (used in bootstrap) */
  accessToken: string;
  syncApiUrl: string;
}

export async function resolveSession(experimentId: string): Promise<SessionInfo> {
  const experiment = await getExperiment(experimentId);
  if (!experiment) throw new Error(`Experiment not found: ${experimentId}`);

  const syncApiUrl = process.env.SYNC_API_URL ?? "http://localhost:3002";
  const accessToken = experiment.accessToken ?? process.env.FEATBIT_ACCESS_TOKEN ?? "";

  if (experiment.sandboxId) {
    const valid = await isSessionValid(experiment.sandboxId);
    if (valid) {
      return { sessionId: experiment.sandboxId, isNew: false, accessToken, syncApiUrl };
    }
  }

  const sessionId = await createSession();
  await saveSandboxSession(experimentId, sessionId, "active");
  return { sessionId, isNew: true, accessToken, syncApiUrl };
}

async function isSessionValid(sessionId: string): Promise<boolean> {
  const res = await fetch(`${BASE_URL}/v1/sessions/${sessionId}`, { headers: HEADERS });
  if (!res.ok) return false;
  const session = (await res.json()) as { status?: string };
  return session.status !== "terminated";
}

async function createSession(): Promise<string> {
  const version = process.env.MANAGED_AGENT_VERSION ?? "default";
  const agent = await getManagedAgent(version);
  if (!agent) {
    throw new Error(
      `No managed agent found for version "${version}". Run: npm run setup-agent`,
    );
  }

  const llmVault = await getVault("llm");
  const vaultIds = llmVault ? [llmVault.vaultId] : [];

  const session = await createChatSession(agent.agentId, agent.environmentId, vaultIds);
  return session.sessionId;
}

/**
 * Bootstrap message sent to a brand-new session to activate the skill.
 * Mirrors modules/sandbox/src/prompt.ts — just the slash command with
 * `<experiment-id> [access-token]` args, nothing else.
 */
export function buildBootstrapMessage(info: SessionInfo, experimentId: string): string {
  return `/featbit-release-decision ${experimentId} ${info.accessToken}`.trimEnd();
}

export async function sendMessage(sessionId: string, text: string): Promise<void> {
  await sendChatMessage(sessionId, text);
}

/**
 * Poll-based event stream. Yields every new event after lastId, then yields
 * a synthetic "session.status_idle" marker when the session goes idle/terminated.
 */
export async function* openStream(
  sessionId: string,
  pollIntervalMs = 500,
): AsyncIterable<{ type: string; [k: string]: unknown }> {
  let lastId: string | undefined;
  while (true) {
    const events = await getSessionEvents(sessionId, lastId);
    for (const evt of events) {
      if (evt.id) lastId = evt.id;
      yield { type: evt.type, ...evt.raw as object };
    }
    const status = await getSessionStatus(sessionId);
    if (status === "idle") {
      yield { type: "session.status_idle" };
      return;
    }
    if (status === "terminated") {
      yield { type: "session.status_terminated" };
      return;
    }
    await new Promise((r) => setTimeout(r, pollIntervalMs));
  }
}
