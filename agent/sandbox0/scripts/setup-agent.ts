#!/usr/bin/env tsx
/**
 * setup-agent.ts
 *
 * One-time bootstrap script that creates the Managed Agent and Environment,
 * then saves the resulting IDs to .agent-config.json.
 *
 * Run once:
 *   npm run setup
 *
 * Re-run any time you want to regenerate the agent (e.g., after updating SKILL.md).
 * The old agent / environment will still exist in Anthropic Console — you can
 * delete them manually if desired.
 */

import "dotenv/config";
import { createAgentAndEnvironment } from "../src/agent-setup.js";
import { buildSystemPrompt } from "../src/skill-loader.js";

async function main() {
  console.log("FeatBit Release Decision — Managed Agent Setup");
  console.log("=".repeat(50));

  // Validate ANTHROPIC_API_KEY early
  if (!process.env.ANTHROPIC_API_KEY) {
    console.error("\nERROR: ANTHROPIC_API_KEY is not set.");
    console.error("Copy .env.example → .env and fill in your API key.");
    process.exit(1);
  }

  // Show a preview of the system prompt size
  let systemPrompt: string;
  try {
    systemPrompt = buildSystemPrompt();
  } catch (err) {
    console.error(`\nERROR: ${String(err)}`);
    process.exit(1);
  }
  const tokens = Math.round(systemPrompt.length / 4); // rough estimate
  console.log(`\nSystem prompt: ~${systemPrompt.length} chars (~${tokens} tokens)`);

  console.log("\nCreating Managed Agent + Environment...\n");
  const config = await createAgentAndEnvironment();

  console.log("\n" + "=".repeat(50));
  console.log("Setup complete. Add these to your .env if you want to pin them:");
  console.log(`  MANAGED_AGENT_ID=${config.agentId}`);
  console.log(`  MANAGED_ENVIRONMENT_ID=${config.environmentId}`);
  console.log("\nRun the console with:");
  console.log("  npm run dev");
}

main().catch((err) => {
  console.error("\nSetup failed:", err);
  process.exit(1);
});
