/**
 * session.ts
 *
 * Session lifecycle for the FeatBit Release Decision console.
 *
 * Sessions are persisted to .sessions.json (keyed by project ID) so the
 * console can resume across restarts. A session stays alive on the Anthropic
 * side after going status_idle — re-attaching the stream and sending a new
 * message continues the same conversation context.
 */

import { getClient } from "./client.js";
import { getSavedSession, saveSession, clearSession } from "./session-store.js";

export interface SessionHandle {
  sessionId: string;
  projectId: string;
  syncApiUrl: string;
  /** true = brand-new session; false = resumed from a previous run */
  isNew: boolean;
}

/**
 * Return a SessionHandle for the given project.
 *
 * Behaviour:
 *   1. If a session ID is stored for this project, try to resume it.
 *   2. If the stored session is no longer valid (expired / deleted), fall back
 *      to creating a new one.
 *   3. If no stored session exists, create a new one.
 */
export async function getOrCreateSession(
  agentId: string,
  environmentId: string,
  projectId: string,
): Promise<SessionHandle> {
  const syncApiUrl = process.env.SYNC_API_URL ?? "http://localhost:3000";
  const savedId = getSavedSession(projectId);

  if (savedId) {
    const valid = await isSessionValid(savedId);
    if (valid) {
      saveSession(projectId, savedId); // update lastActiveAt
      return { sessionId: savedId, projectId, syncApiUrl, isNew: false };
    }
    // Stored session has expired — clear it and fall through to create
    clearSession(projectId);
  }

  return createSession(agentId, environmentId, projectId, syncApiUrl);
}

/**
 * Force-create a new session, discarding any stored session for the project.
 */
export async function createSession(
  agentId: string,
  environmentId: string,
  projectId: string,
  syncApiUrl?: string,
): Promise<SessionHandle> {
  const client = getClient();
  const url = syncApiUrl ?? process.env.SYNC_API_URL ?? "http://localhost:3000";

  const session = await (client.beta as any).sessions.create({
    agent: agentId,
    environment_id: environmentId,
    title: `FeatBit Release Decision — ${projectId}`,
  });

  saveSession(projectId, session.id);
  return { sessionId: session.id, projectId, syncApiUrl: url, isNew: true };
}

/**
 * Check whether a session still exists and is in a usable state.
 *
 * Calls GET /v1/sessions/:id and checks the status field.
 * - idle / running / rescheduling  → usable
 * - terminated                     → dead, need a new session
 * - network error / 404            → treat as dead
 */
async function isSessionValid(sessionId: string): Promise<boolean> {
  const client = getClient();
  try {
    const session = await (client.beta as any).sessions.retrieve(sessionId);
    return session.status !== "terminated";
  } catch {
    return false;
  }
}

/**
 * Build the session activation message for a *new* session.
 *
 * This is the Managed Agents equivalent of the Claude Code slash command:
 *   /featbit-release-decision <projectId> <accessToken>
 *
 * In the Claude Code SDK, that command loads the skill and injects project
 * context as positional arguments. Here, the skill is already in the system
 * prompt — this message activates it by supplying the same two arguments
 * (project ID and access token) plus the sync URL.
 */
export function buildBootstrapMessage(handle: SessionHandle): string {
  const accessToken = process.env.FEATBIT_ACCESS_TOKEN ?? "";
  return [
    `/featbit-release-decision ${handle.projectId} ${accessToken}`.trimEnd(),
    ``,
    `SYNC_API_URL=${handle.syncApiUrl}`,
    ``,
    `Activate the FeatBit Release Decision framework for project "${handle.projectId}".`,
    `Read the current project state, then report the stage and open questions.`,
    `\`\`\`bash`,
    `curl -s "${handle.syncApiUrl}/api/experiments/${handle.projectId}" | jq .`,
    `\`\`\``,
  ].join("\n");
}

/**
 * Send a plain text user message to the session.
 */
export async function sendMessage(sessionId: string, text: string): Promise<void> {
  const client = getClient();
  await (client.beta as any).sessions.events.send(sessionId, {
    events: [
      {
        type: "user.message",
        content: [{ type: "text", text }],
      },
    ],
  });
}

/**
 * Send a user.interrupt event — stops the agent mid-execution.
 * The agent will finish its current tool call (if any) and emit
 * session.status_idle with stop_reason "interrupted".
 */
export async function sendInterrupt(sessionId: string): Promise<void> {
  const client = getClient();
  await (client.beta as any).sessions.events.send(sessionId, {
    events: [{ type: "user.interrupt" }],
  });
}

/**
 * Open (or re-attach to) the SSE event stream for the session.
 */
export async function openStream(sessionId: string): Promise<AsyncIterable<any>> {
  const client = getClient();
  return (client.beta as any).sessions.events.stream(sessionId);
}
