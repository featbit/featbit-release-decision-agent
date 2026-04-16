/**
 * session.ts
 *
 * CMA session lifecycle for sandbox0-streaming.
 *
 * Unlike sandbox0 (which stores sessions in .sessions.json), this service
 * uses the database: experiment.sandbox_id holds the active CMA session ID.
 *
 * Flow per /query request:
 *   1. Look up experiment in DB → get sandboxId
 *   2. If sandboxId exists, verify it is still alive
 *   3. If dead or missing, create a new session and persist it
 *   4. Return SessionInfo so the caller can send messages and open the stream
 */

import { getClient } from "./client.js";
import { getExperiment, saveSandboxSession, getManagedAgent, getVault } from "./db.js";

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

  const syncApiUrl = process.env.SYNC_API_URL ?? "http://localhost:3000";
  const accessToken = experiment.accessToken ?? process.env.FEATBIT_ACCESS_TOKEN ?? "";

  if (experiment.sandboxId) {
    const valid = await isSessionValid(experiment.sandboxId);
    if (valid) {
      return { sessionId: experiment.sandboxId, isNew: false, accessToken, syncApiUrl };
    }
  }

  // Create a fresh session and persist the ID
  const sessionId = await createSession(experimentId);
  await saveSandboxSession(experimentId, sessionId, "active");
  return { sessionId, isNew: true, accessToken, syncApiUrl };
}

async function isSessionValid(sessionId: string): Promise<boolean> {
  try {
    const session = await (getClient().beta as any).sessions.retrieve(sessionId);
    return session.status !== "terminated";
  } catch {
    return false;
  }
}

async function createSession(experimentId: string): Promise<string> {
  const version = process.env.MANAGED_AGENT_VERSION ?? "default";
  const agent = await getManagedAgent(version);
  if (!agent) {
    throw new Error(
      `No managed agent found for version "${version}". Run: npm run setup-agent`,
    );
  }

  // Attach LLM vault if available
  const llmVault = await getVault("llm");
  const vaultIds = llmVault ? [llmVault.vaultId] : [];

  const session = await (getClient().beta as any).sessions.create({
    agent: agent.agentId,
    environment_id: agent.environmentId,
    vault_ids: vaultIds,
    title: `FeatBit Release Decision — ${experimentId}`,
  });
  return session.id as string;
}

/** Bootstrap message sent to a brand-new session to activate the skill. */
export function buildBootstrapMessage(info: SessionInfo, experimentId: string): string {
  const { accessToken, syncApiUrl } = info;
  return [
    `/featbit-release-decision ${experimentId} ${accessToken}`.trimEnd(),
    ``,
    `SYNC_API_URL=${syncApiUrl}`,
    ``,
    `Activate the FeatBit Release Decision framework for project "${experimentId}".`,
    `Read the current project state, then report the stage and open questions.`,
    `\`\`\`bash`,
    `curl -s "${syncApiUrl}/api/experiments/${experimentId}" | jq .`,
    `\`\`\``,
  ].join("\n");
}

export async function sendMessage(sessionId: string, text: string): Promise<void> {
  await (getClient().beta as any).sessions.events.send(sessionId, {
    events: [{ type: "user.message", content: [{ type: "text", text }] }],
  });
}

export async function openStream(sessionId: string): Promise<AsyncIterable<any>> {
  return (getClient().beta as any).sessions.events.stream(sessionId);
}
