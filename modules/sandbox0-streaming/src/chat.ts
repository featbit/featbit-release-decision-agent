/**
 * chat.ts
 *
 * Lightweight chat session manager that talks to sandbox0 REST API.
 * Unlike session.ts (which is tied to experiments), this supports
 * free-form conversations for the /chat endpoint.
 */

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

export interface ChatSession {
  sessionId: string;
  agentId: string;
  environmentId: string;
}

export async function createChatSession(
  agentId: string,
  environmentId: string,
  vaultIds: string[],
): Promise<ChatSession> {
  const session = await s0Post("/v1/sessions", {
    agent: agentId,
    environment_id: environmentId,
    vault_ids: vaultIds,
    title: "web-chat",
  });
  return { sessionId: session.id, agentId, environmentId };
}

export async function sendChatMessage(sessionId: string, text: string): Promise<void> {
  await s0Post(`/v1/sessions/${sessionId}/events`, {
    events: [{ type: "user.message", content: [{ type: "text", text }] }],
  });
}

export async function getSessionStatus(sessionId: string): Promise<string> {
  const session = await s0Get(`/v1/sessions/${sessionId}`);
  return session.status;
}

export interface ChatEvent {
  id: string;
  type: string;
  processedAt: string;
  content?: string;
  toolName?: string;
  toolInput?: unknown;
  raw: unknown;
}

export async function getSessionEvents(
  sessionId: string,
  afterId?: string,
): Promise<ChatEvent[]> {
  const path =
    `/v1/sessions/${sessionId}/events` + (afterId ? `?after_id=${afterId}` : "");
  const result = await s0Get(path);
  const rawEvents: any[] = result.data ?? [];

  // Sort chronologically
  rawEvents.sort(
    (a: any, b: any) =>
      new Date(a.processed_at).getTime() - new Date(b.processed_at).getTime(),
  );

  return rawEvents.map((evt) => {
    const text = evt.content
      ?.filter((c: any) => c.type === "text")
      .map((c: any) => c.text)
      .join("");

    return {
      id: evt.id,
      type: evt.type,
      processedAt: evt.processed_at,
      content: text || undefined,
      toolName: evt.name,
      toolInput: evt.input,
      raw: evt,
    };
  });
}
