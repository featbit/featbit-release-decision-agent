import Anthropic from "@anthropic-ai/sdk";

let _client: Anthropic | null = null;

/** Return the shared Anthropic client pointed at the sandbox0 managed-agents service. */
export function getClient(): Anthropic {
  if (!_client) {
    const apiKey = process.env.SANDBOX0_API_KEY;
    if (!apiKey) throw new Error("SANDBOX0_API_KEY is not set");
    _client = new Anthropic({
      baseURL: process.env.SANDBOX0_BASE_URL ?? "https://agents.sandbox0.ai",
      apiKey,
    });
  }
  return _client;
}
