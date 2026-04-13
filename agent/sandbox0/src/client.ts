import Anthropic from "@anthropic-ai/sdk";

let _client: Anthropic | null = null;

/** Return the shared Anthropic client. The beta header for Managed Agents
 *  (`managed-agents-2026-04-01`) is set automatically by the SDK on all
 *  `client.beta.*` calls. */
export function getClient(): Anthropic {
  if (!_client) {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      throw new Error("ANTHROPIC_API_KEY is not set. Copy .env.example → .env and fill it in.");
    }
    _client = new Anthropic({ apiKey });
  }
  return _client;
}
