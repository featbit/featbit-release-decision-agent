"use client";

import { useCallback, useEffect, useRef, useState } from "react";

// ── Types ────────────────────────────────────────────────────────────────────

export interface ChatMessage {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  createdAt: Date;
}

interface UseSandboxChatOptions {
  /** The experiment ID used to scope the agent session */
  experimentId: string;
  /** Base URL of the sandbox server (default: http://localhost:3100) */
  sandboxUrl?: string;
  /** Max agent turns per request */
  maxTurns?: number;
  /** Working directory for the agent */
  cwd?: string;
  /** Existing messages from DB to seed chat history */
  initialMessages?: ChatMessage[];
  /** Called when a stream completes with the user prompt and assistant reply */
  onStreamComplete?: (userContent: string, assistantContent: string) => void;
}

export type ConnectionStatus = "checking" | "connected" | "disconnected";

interface UseSandboxChatReturn {
  messages: ChatMessage[];
  isStreaming: boolean;
  error: string | null;
  connectionStatus: ConnectionStatus;
  /** Send a message (empty string triggers session init) */
  sendMessage: (content: string) => void;
  /** Abort the current stream */
  abort: () => void;
}

// ── Hook ─────────────────────────────────────────────────────────────────────

let msgCounter = 0;
function nextId() {
  return `msg-${Date.now()}-${++msgCounter}`;
}

export function useSandboxChat({
  experimentId,
  sandboxUrl = process.env.NEXT_PUBLIC_SANDBOX_URL ?? "http://localhost:3100",
  maxTurns = 50,
  cwd,
  initialMessages = [],
  onStreamComplete,
}: UseSandboxChatOptions): UseSandboxChatReturn {
  const [messages, setMessages] = useState<ChatMessage[]>(initialMessages);
  const [isStreaming, setIsStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>("checking");
  const abortRef = useRef<AbortController | null>(null);
  const isInitialized = useRef(false);
  const streamAccRef = useRef(""); // accumulate assistant text during stream
  const onCompleteRef = useRef(onStreamComplete);
  onCompleteRef.current = onStreamComplete;

  // Health check on mount
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`${sandboxUrl}/health`, { signal: AbortSignal.timeout(3000) });
        if (!cancelled) setConnectionStatus(res.ok ? "connected" : "disconnected");
      } catch {
        if (!cancelled) setConnectionStatus("disconnected");
      }
    })();
    return () => { cancelled = true; };
  }, [sandboxUrl]);

  const appendAssistantDelta = useCallback((text: string) => {
    streamAccRef.current += text;
    setMessages((prev) => {
      const last = prev[prev.length - 1];
      if (last && last.role === "assistant" && last.id.startsWith("stream-")) {
        // Append to in-progress assistant message
        return [
          ...prev.slice(0, -1),
          { ...last, content: last.content + text },
        ];
      }
      // Start a new assistant message
      return [
        ...prev,
        {
          id: `stream-${nextId()}`,
          role: "assistant" as const,
          content: text,
          createdAt: new Date(),
        },
      ];
    });
  }, []);

  const sendMessage = useCallback(
    (content: string) => {
      // Don't send while already streaming
      if (abortRef.current) return;

      setError(null);

      // Add user message to chat (skip for empty init)
      if (content.trim()) {
        setMessages((prev) => [
          ...prev,
          {
            id: nextId(),
            role: "user",
            content: content.trim(),
            createdAt: new Date(),
          },
        ]);
      }

      const controller = new AbortController();
      abortRef.current = controller;
      setIsStreaming(true);
      streamAccRef.current = "";

      // Build request body
      const body: Record<string, unknown> = {
        projectId: experimentId,
        maxTurns,
      };
      if (content.trim()) {
        body.prompt = content.trim();
      }
      if (cwd) {
        body.cwd = cwd;
      }

      // Start SSE fetch
      (async () => {
        try {
          const res = await fetch(`${sandboxUrl}/query`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
            signal: controller.signal,
          });

          if (!res.ok) {
            const err = await res.json().catch(() => ({ error: res.statusText }));
            throw new Error(err.error || `HTTP ${res.status}`);
          }

          const reader = res.body?.getReader();
          if (!reader) throw new Error("No response body");

          const decoder = new TextDecoder();
          let buffer = "";

          while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });

            // Parse SSE frames from buffer
            const lines = buffer.split("\n");
            buffer = lines.pop() ?? ""; // Keep incomplete line in buffer

            let currentEvent = "";
            for (const line of lines) {
              if (line.startsWith("event: ")) {
                currentEvent = line.slice(7).trim();
              } else if (line.startsWith("data: ") && currentEvent) {
                const jsonStr = line.slice(6);
                try {
                  const data = JSON.parse(jsonStr);
                  handleSseEvent(currentEvent, data);
                } catch {
                  // Ignore malformed JSON
                }
                currentEvent = "";
              } else if (line === "") {
                currentEvent = "";
              }
            }
          }

          // Mark session as initialized after first successful exchange
          isInitialized.current = true;
          setConnectionStatus("connected");

          // Notify caller for persistence
          if (streamAccRef.current) {
            onCompleteRef.current?.(content.trim(), streamAccRef.current);
          }
        } catch (err: unknown) {
          if (err instanceof DOMException && err.name === "AbortError") {
            // User aborted — not an error
          } else {
            const message = err instanceof Error ? err.message : String(err);
            setError(message);
            setConnectionStatus("disconnected");
          }
        } finally {
          abortRef.current = null;
          setIsStreaming(false);
        }
      })();

      function handleSseEvent(event: string, data: unknown) {
        const d = data as Record<string, unknown>;

        if (event === "stream_event") {
          // Extract text deltas
          const evt = d.event as Record<string, unknown> | undefined;
          if (!evt) return;

          if (evt.type === "content_block_delta") {
            const delta = evt.delta as Record<string, string> | undefined;
            if (delta?.type === "text_delta" && delta.text) {
              appendAssistantDelta(delta.text);
            }
          }
        } else if (event === "error") {
          const msg =
            (d as { message?: string }).message ?? "Unknown agent error";
          setError(msg);
        }
        // system, message, result, tool_progress, done — ignored for chat display
      }
    },
    [experimentId, sandboxUrl, maxTurns, cwd, appendAssistantDelta]
  );

  const abort = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setIsStreaming(false);
  }, []);

  return { messages, isStreaming, error, connectionStatus, sendMessage, abort };
}
