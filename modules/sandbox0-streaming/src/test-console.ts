/**
 * test-console.ts
 *
 * Console test client for sandbox0-streaming.
 * Creates a session via sandbox0 API, sends a message, and polls for events.
 *
 * Usage:
 *   npx tsx src/test-console.ts                    # simple connectivity test
 *   npx tsx src/test-console.ts "What is 2+2?"     # send a prompt
 */

import "dotenv/config";
import { ensureManagedAgentTable, getManagedAgent, getVault, ensureVaultTable } from "./db.js";

const BASE_URL = process.env.SANDBOX0_BASE_URL ?? "https://agents.sandbox0.ai";
const API_KEY = process.env.SANDBOX0_API_KEY ?? "";

const HEADERS: Record<string, string> = {
  "Content-Type": "application/json",
  "x-api-key": API_KEY,
  "anthropic-version": "2023-06-01",
  "anthropic-beta": "managed-agents-2026-04-01",
};

async function s0Post(path: string, body: unknown): Promise<any> {
  const res = await fetch(`${BASE_URL}${path}`, {
    method: "POST",
    headers: HEADERS,
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`POST ${path} → ${res.status}: ${text}`);
  }
  return res.json();
}

async function s0Get(path: string): Promise<any> {
  const res = await fetch(`${BASE_URL}${path}`, { headers: HEADERS });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`GET ${path} → ${res.status}: ${text}`);
  }
  return res.json();
}

/** Poll session until idle/terminated, then fetch all events and display. */
async function waitAndDisplay(sessionId: string): Promise<void> {
  // Wait for session to finish
  while (true) {
    const session = await s0Get(`/v1/sessions/${sessionId}`);
    const status = session.status as string;
    process.stdout.write(".");
    if (status === "idle" || status === "terminated") break;
    await new Promise((r) => setTimeout(r, 2000));
  }
  console.log("\n");

  // Fetch all events
  const result = await s0Get(`/v1/sessions/${sessionId}/events`);
  const events: any[] = result.data ?? [];

  // Sort chronologically
  events.sort((a: any, b: any) =>
    new Date(a.processed_at).getTime() - new Date(b.processed_at).getTime(),
  );

  for (const evt of events) {
    const t = evt.type as string;

    if (t === "user.message") {
      const text = evt.content
        ?.filter((c: any) => c.type === "text")
        .map((c: any) => c.text)
        .join("");
      if (text) console.log(`\n[user] ${text}`);
    } else if (t === "agent.message") {
      const text = evt.content
        ?.filter((c: any) => c.type === "text")
        .map((c: any) => c.text)
        .join("");
      if (text) console.log(`\n[agent] ${text}`);
    } else if (t === "agent.tool_use") {
      console.log(`\n[tool_use] ${evt.name ?? "unknown"}`);
      if (evt.input) console.log(JSON.stringify(evt.input, null, 2));
    } else if (t === "agent.tool_result") {
      const content = evt.content
        ?.filter((c: any) => c.type === "text")
        .map((c: any) => c.text)
        .join("")
        .substring(0, 500);
      if (content) console.log(`[tool_result] ${content}...`);
    } else if (t === "session.status_idle") {
      console.log("\n── session idle ──");
    } else if (t === "session.status_terminated") {
      console.log("\n── session terminated ──");
    }
  }
}

async function main() {
  const prompt = process.argv[2] || "Hello! What can you do?";

  // 1. Resolve agent + environment from DB
  await ensureManagedAgentTable();
  await ensureVaultTable();

  const version = process.env.MANAGED_AGENT_VERSION ?? "default";
  const agent = await getManagedAgent(version);
  if (!agent) {
    console.error(`No managed agent found for version "${version}". Run: npm run setup-agent`);
    process.exit(1);
  }

  const llmVault = await getVault("llm");
  const vaultIds = llmVault ? [llmVault.vaultId] : [];

  console.log(`Agent:       ${agent.agentId}`);
  console.log(`Environment: ${agent.environmentId}`);
  console.log(`Vault IDs:   ${vaultIds.length ? vaultIds.join(", ") : "(none)"}`);
  console.log(`Prompt:      ${prompt}`);
  console.log("─".repeat(60));

  // 2. Create session
  console.log("\n[1] Creating session...");
  const session = await s0Post("/v1/sessions", {
    agent: agent.agentId,
    environment_id: agent.environmentId,
    vault_ids: vaultIds,
    title: "test-console",
  });
  const sessionId = session.id;
  console.log(`    Session ID: ${sessionId}`);

  // 3. Send message
  console.log(`\n[2] Sending message...`);
  await s0Post(`/v1/sessions/${sessionId}/events`, {
    events: [{ type: "user.message", content: [{ type: "text", text: prompt }] }],
  });

  // 4. Wait and display response
  console.log(`\n[3] Waiting for response...`);
  await waitAndDisplay(sessionId);

  process.exit(0);
}

main().catch((err) => {
  console.error("\nFailed:", err);
  process.exit(1);
});
