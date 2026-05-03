import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";

// SSE event names sent to the FeatBit web client.
export type SseEventName =
  | "stream_event"
  | "message"
  | "result"
  | "system"
  | "tool_progress"
  | "error"
  | "done";

export interface SseEvent {
  event: SseEventName;
  data: unknown;
}

export interface QueryRequestBody {
  prompt?: string;
  experimentId?: string;
  /** @deprecated alias for experimentId, kept for backward compatibility */
  projectId?: string;
  accessToken?: string;
  maxTurns?: number;
  allowedTools?: string[];
  cwd?: string;
}

export interface ActiveSession {
  sessionId: string;
  abortController: AbortController;
  startedAt: number;
}

export type { SDKMessage };
