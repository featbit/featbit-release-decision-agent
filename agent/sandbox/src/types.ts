import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";

// ── SSE event shapes sent to clients ──────────────────────────────────────────

export type SseEventName =
  | "stream_event"   // SDKPartialAssistantMessage (text delta / tool delta)
  | "message"        // SDKAssistantMessage (complete turn)
  | "result"         // SDKResultMessage
  | "system"         // SDKSystemMessage / status / boundary
  | "tool_progress"  // SDKToolProgressMessage
  | "error"          // server-side error
  | "done";          // stream finished

export interface SseEvent {
  event: SseEventName;
  data: unknown;
}

// ── HTTP request body for POST /query ─────────────────────────────────────────

export interface QueryRequestBody {
  /** User prompt text */
  prompt: string;
  /** Project ID – used to derive a deterministic session UUID and for skill context */
  projectId?: string;
  /** Access token for the initial skill invocation (new session only) */
  accessToken?: string;
  /** Max agentic turns (defaults to 10) */
  maxTurns?: number;
  /** Tool names to auto-approve */
  allowedTools?: string[];
  /** Working directory for the agent */
  cwd?: string;
}

// ── Active session bookkeeping ─────────────────────────────────────────────────

export interface ActiveSession {
  sessionId: string;
  abortController: AbortController;
  startedAt: number;
}

// ── Re-export SDK message type for convenience ─────────────────────────────────

export type { SDKMessage };
