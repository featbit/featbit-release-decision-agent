#!/usr/bin/env tsx
/**
 * Interactive CLI client for the Claude Agent SSE server.
 *
 * Usage: tsx scripts/chat.ts [base-url] [project-id] [access-token]
 * Default base URL: http://localhost:3001
 *
 * Type a prompt and press Enter. The agent streams its response in real-time.
 * The session is automatically continued across turns.
 * Type "exit" or press Ctrl+C to quit.
 */
import * as readline from "readline";

const BASE_URL = process.argv[2] ?? "http://localhost:3001";
const PROJECT_ID = process.argv[3] ?? undefined;
const ACCESS_TOKEN = process.argv[4] ?? undefined;
let sessionId: string | null = null;
let turnCount = 0;

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

function prompt(): void {
  const label = sessionId ? `[turn ${turnCount + 1}]` : "[new session]";
  rl.question(`\n${label} You: `, async (input) => {
    const trimmed = input.trim();
    if (!trimmed || trimmed.toLowerCase() === "exit") {
      console.log("Bye!");
      rl.close();
      process.exit(0);
    }
    await sendQuery(trimmed);
    prompt();
  });
}

async function sendQuery(userPrompt: string): Promise<void> {
  const body: Record<string, unknown> = { prompt: userPrompt };
  if (sessionId) {
    body.sessionId = sessionId;
  }
  if (!sessionId && PROJECT_ID) {
    body.projectId = PROJECT_ID;
  }
  if (!sessionId && ACCESS_TOKEN) {
    body.accessToken = ACCESS_TOKEN;
  }

  let response: globalThis.Response;
  try {
    response = await fetch(`${BASE_URL}/query`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch (err) {
    console.error(`\n[error] Cannot connect to ${BASE_URL}:`, (err as Error).message);
    return;
  }

  if (!response.ok) {
    console.error(`\n[error] HTTP ${response.status}:`, await response.text());
    return;
  }

  if (!response.body) {
    console.error("\n[error] No response body");
    return;
  }

  turnCount++;
  process.stdout.write("\nAgent: ");

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });

    // Parse SSE lines from buffer
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? ""; // keep incomplete last line

    let currentEvent = "";
    for (const line of lines) {
      if (line.startsWith("event: ")) {
        currentEvent = line.slice(7).trim();
      } else if (line.startsWith("data: ") && currentEvent) {
        const data = line.slice(6);
        handleEvent(currentEvent, data);
        currentEvent = "";
      }
    }
  }

  process.stdout.write("\n");
}

function handleEvent(event: string, rawData: string): void {
  let data: Record<string, unknown>;
  try {
    data = JSON.parse(rawData);
  } catch {
    return;
  }

  switch (event) {
    case "system": {
      // Capture session_id from init
      if (data.session_id && typeof data.session_id === "string") {
        sessionId = data.session_id;
      }
      break;
    }

    case "stream_event": {
      // Print text deltas in real-time
      const evt = data.event as Record<string, unknown> | undefined;
      if (!evt) break;

      if (evt.type === "content_block_delta") {
        const delta = evt.delta as Record<string, unknown> | undefined;
        if (delta?.type === "text_delta" && typeof delta.text === "string") {
          process.stdout.write(delta.text);
        }
      }
      break;
    }

    case "result": {
      // Show final result summary
      if (data.result && typeof data.result === "string") {
        // Clear the streaming line and show the clean result
        process.stdout.write(`\n\n--- Result ---\n${data.result}`);
      }
      if (data.session_id && typeof data.session_id === "string") {
        sessionId = data.session_id;
      }
      const cost = data.total_cost_usd;
      if (typeof cost === "number") {
        process.stdout.write(`\n[cost: $${cost.toFixed(4)}]`);
      }
      break;
    }

    case "error": {
      const msg = data.message ?? JSON.stringify(data);
      process.stdout.write(`\n[error] ${msg}`);
      break;
    }

    case "done":
      break;

    default:
      break;
  }
}

console.log(`Claude Agent Chat — connected to ${BASE_URL}`);
console.log(`Type your message and press Enter. Type "exit" to quit.\n`);

// Auto-send the first turn so the skill context is loaded and
// the agent greets the user with guidance based on its entry protocol.
(async () => {
  console.log("[new session] Initializing...\n");
  await sendQuery("I'm starting a new release decision session. Please scan the workspace for existing context and guide me on what to do next.");
  prompt();
})();
