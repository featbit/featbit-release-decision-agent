/**
 * agent-setup.ts
 *
 * Creates (or loads) the Managed Agent and Environment.
 *
 * Agent creation attaches all uploaded custom skills — they are loaded on
 * demand by the agent (progressive disclosure), not pre-loaded into context.
 *
 * Skills must be uploaded first via `npm run upload-skills`.
 * Agent + environment IDs are persisted in .sessions.json.
 */

import { getClient } from "./client.js";
import { buildSystemPrompt } from "./skill-loader.js";
import { getSavedAgent, saveAgent, getSavedSkills } from "./session-store.js";

export interface AgentConfig {
  agentId: string;
  agentVersion: number;
  environmentId: string;
}

/**
 * Return a saved AgentConfig from .sessions.json, or create a new one.
 * Agent and Environment are created once and reused across restarts.
 */
export async function ensureAgentConfig(): Promise<AgentConfig> {
  const saved = getSavedAgent();
  if (saved) return saved;

  return createAgentAndEnvironment();
}

/**
 * Force-create a new Agent and Environment.
 * Attaches all uploaded custom skills from the store.
 */
export async function createAgentAndEnvironment(): Promise<AgentConfig> {
  const client = getClient();

  // Build skill attachment list from stored skill IDs
  const savedSkills = getSavedSkills();
  const skills = savedSkills
    ? Object.values(savedSkills).map((id) => ({
        type: "custom",
        skill_id: id,
        version: "latest",
      }))
    : [];

  if (skills.length === 0) {
    console.warn(
      "  WARNING: No skills found in .sessions.json. " +
      "Run `npm run upload-skills` first for full skill coverage."
    );
  } else {
    console.log(`  Attaching ${skills.length} custom skill(s).`);
  }

  console.log("Creating Managed Agent...");
  const agent = await (client.beta as any).agents.create({
    name: "FeatBit Release Decision Agent",
    model: "claude-sonnet-4-6",
    system: buildSystemPrompt(),
    tools: [{ type: "agent_toolset_20260401" }],
    skills,
  });
  console.log(`  Agent ID:      ${agent.id}`);
  console.log(`  Agent version: ${agent.version}`);

  console.log("Creating Environment (cloud / unrestricted networking)...");
  const environment = await (client.beta as any).environments.create({
    name: "featbit-release-decision-env",
    config: {
      type: "cloud",
      networking: { type: "unrestricted" },
    },
  });
  console.log(`  Environment ID: ${environment.id}`);

  const config: AgentConfig = {
    agentId: agent.id,
    agentVersion: agent.version,
    environmentId: environment.id,
  };

  saveAgent(config);
  return config;
}
