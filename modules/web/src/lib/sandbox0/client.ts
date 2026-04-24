/**
 * Thin REST client for the sandbox0 Managed Agents API.
 *
 * Mirrors modules/sandbox0-streaming/src/chat.ts (which was built on raw
 * fetch because the installed @anthropic-ai/sdk at the time did not expose
 * beta.sessions). Reusing the same shape keeps the route handlers simple.
 */

const BASE_URL = process.env.SANDBOX0_BASE_URL ?? "https://agents.sandbox0.ai";
const API_KEY = process.env.SANDBOX0_API_KEY ?? "";

const HEADERS: Record<string, string> = {
  "Content-Type": "application/json",
  "x-api-key": API_KEY,
  "anthropic-version": "2023-06-01",
  "anthropic-beta": "managed-agents-2026-04-01",
};

async function s0Post<T = unknown>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, {
    method: "POST",
    headers: HEADERS,
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    throw new Error(`POST ${path} → ${res.status}: ${await res.text()}`);
  }
  return (await res.json()) as T;
}

async function s0Get<T = unknown>(path: string): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, { headers: HEADERS });
  if (!res.ok) {
    throw new Error(`GET ${path} → ${res.status}: ${await res.text()}`);
  }
  return (await res.json()) as T;
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
  const session = await s0Post<{ id: string }>("/v1/sessions", {
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
  const session = await s0Get<{ status: string }>(`/v1/sessions/${sessionId}`);
  return session.status;
}

export async function terminateSession(sessionId: string): Promise<void> {
  await fetch(`${BASE_URL}/v1/sessions/${sessionId}`, {
    method: "DELETE",
    headers: HEADERS,
  });
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
  const result = await s0Get<{ data?: unknown[] }>(path);
  const rawEvents = (result.data ?? []) as Array<{
    id: string;
    type: string;
    processed_at: string;
    content?: Array<{ type: string; text?: string }>;
    name?: string;
    input?: unknown;
  }>;

  // Chronological order
  rawEvents.sort(
    (a, b) => new Date(a.processed_at).getTime() - new Date(b.processed_at).getTime(),
  );

  return rawEvents.map((evt) => {
    const text = evt.content
      ?.filter((c) => c.type === "text")
      .map((c) => c.text ?? "")
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

export async function isSessionAlive(sessionId: string): Promise<boolean> {
  try {
    const status = await getSessionStatus(sessionId);
    return status !== "terminated";
  } catch {
    return false;
  }
}
