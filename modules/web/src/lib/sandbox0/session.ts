/**
 * Experiment-scoped Managed Agent session resolver.
 *
 * One experiment maps to one sandbox0 session (stored in experiment.sandbox_id).
 * Reused until the session is terminated on the sandbox0 side; then a fresh
 * one is created on the next /chat/start and its bootstrap slash command is
 * re-sent so the agent can restore context from the DB via get-experiment.
 */

import {
  getExperiment,
  saveSandboxSession,
  getManagedAgent,
  getVault,
} from "./db";
import {
  createChatSession,
  sendChatMessage,
  isSessionAlive,
} from "./client";

export interface SessionInfo {
  sessionId: string;
  /** true = brand-new session that needs a bootstrap message */
  isNew: boolean;
  /** FeatBit access token for this experiment (used in bootstrap) */
  accessToken: string;
}

export async function resolveSession(experimentId: string): Promise<SessionInfo> {
  const experiment = await getExperiment(experimentId);
  if (!experiment) throw new Error(`Experiment not found: ${experimentId}`);

  const accessToken =
    experiment.accessToken ?? process.env.FEATBIT_ACCESS_TOKEN ?? "";

  if (experiment.sandboxId) {
    if (await isSessionAlive(experiment.sandboxId)) {
      return { sessionId: experiment.sandboxId, isNew: false, accessToken };
    }
  }

  const sessionId = await createSession();
  await saveSandboxSession(experimentId, sessionId, "active");
  return { sessionId, isNew: true, accessToken };
}

async function createSession(): Promise<string> {
  const version = process.env.MANAGED_AGENT_VERSION ?? "default";
  const agent = await getManagedAgent(version);
  if (!agent) {
    throw new Error(
      `No managed agent found for version "${version}". Run: npm run sandbox0:setup-agent`,
    );
  }

  const llmVault = await getVault("llm");
  const vaultIds = llmVault ? [llmVault.vaultId] : [];

  const session = await createChatSession(
    agent.agentId,
    agent.environmentId,
    vaultIds,
  );
  return session.sessionId;
}

/**
 * Bootstrap message sent to a brand-new session to activate the skill.
 * Mirrors modules/sandbox/src/prompt.ts — just the slash command with
 * `<experiment-id> [access-token]` args.
 */
export function buildBootstrapMessage(info: SessionInfo, experimentId: string): string {
  return `/featbit-release-decision ${experimentId} ${info.accessToken}`.trimEnd();
}

export async function sendMessage(sessionId: string, text: string): Promise<void> {
  await sendChatMessage(sessionId, text);
}
