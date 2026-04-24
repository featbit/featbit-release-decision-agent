"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { ChatMessage, ConnectionStatus } from "@/hooks/use-sandbox-chat";

/**
 * Poll-based chat hook for the sandbox0 (Managed Agents) backend.
 *
 * Mirrors the public shape of `useSandboxChat` so `ChatPanel` can swap
 * between the two transparently based on a build-time flag. The main
 * difference is that events arrive in batches via polling, not as
 * token-by-token SSE deltas — so assistant messages land as whole turns
 * rather than streaming in character-by-character.
 */

interface UseSandbox0ChatOptions {
  experimentId: string;
  initialMessages?: ChatMessage[];
  onStreamComplete?: (userContent: string, assistantContent: string) => void;
  /** Polling cadence for /api/sandbox0/chat/events (default 1500 ms) */
  pollIntervalMs?: number;
}

interface UseSandbox0ChatReturn {
  messages: ChatMessage[];
  isStreaming: boolean;
  error: string | null;
  connectionStatus: ConnectionStatus;
  activity: string | null;
  sendMessage: (content: string) => void;
  abort: () => void;
}

let msgCounter = 0;
function nextId() {
  return `msg-${Date.now()}-${++msgCounter}`;
}

interface SandboxEvent {
  id: string;
  type: string;
  processedAt: string;
  content?: string;
  toolName?: string;
  toolInput?: unknown;
  raw: unknown;
}

export function useSandbox0Chat({
  experimentId,
  initialMessages = [],
  onStreamComplete,
  pollIntervalMs = 1500,
}: UseSandbox0ChatOptions): UseSandbox0ChatReturn {
  const [messages, setMessages] = useState<ChatMessage[]>(initialMessages);
  const [isStreaming, setIsStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [connectionStatus, setConnectionStatus] =
    useState<ConnectionStatus>("connected");
  const [activity, setActivity] = useState<string | null>(null);

  const sessionIdRef = useRef<string | null>(null);
  const lastEventIdRef = useRef<string | undefined>(undefined);
  // Belt-and-suspenders: the sandbox0 /events endpoint accepts `after_id`
  // but we have seen it replay events across polls. We also keep a local
  // set of seen ids so the UI never renders the same agent.message twice.
  const seenEventIdsRef = useRef<Set<string>>(new Set());
  const abortedRef = useRef(false);
  const onCompleteRef = useRef(onStreamComplete);
  onCompleteRef.current = onStreamComplete;

  const appendUserMessage = useCallback((text: string) => {
    setMessages((prev) => [
      ...prev,
      {
        id: nextId(),
        role: "user" as const,
        content: text,
        createdAt: new Date(),
      },
    ]);
  }, []);

  const appendAssistantMessage = useCallback((text: string) => {
    setMessages((prev) => [
      ...prev,
      {
        id: nextId(),
        role: "assistant" as const,
        content: text,
        createdAt: new Date(),
      },
    ]);
  }, []);

  /** Append to the thinking field of the most recent assistant message, or
   *  open a new streaming assistant bubble if none exists yet. */
  const appendAssistantThinking = useCallback((text: string) => {
    setMessages((prev) => {
      const last = prev[prev.length - 1];
      if (last && last.role === "assistant" && last.id.startsWith("stream-")) {
        return [
          ...prev.slice(0, -1),
          { ...last, thinking: (last.thinking ?? "") + text },
        ];
      }
      return [
        ...prev,
        {
          id: `stream-${nextId()}`,
          role: "assistant" as const,
          content: "",
          thinking: text,
          createdAt: new Date(),
        },
      ];
    });
  }, []);

  /** Promote the in-progress thinking bubble into a real assistant message
   *  when the final text arrives. */
  const commitAssistantMessage = useCallback((text: string) => {
    setMessages((prev) => {
      const last = prev[prev.length - 1];
      if (last && last.role === "assistant" && last.id.startsWith("stream-")) {
        return [
          ...prev.slice(0, -1),
          { ...last, id: nextId(), content: text },
        ];
      }
      return [
        ...prev,
        {
          id: nextId(),
          role: "assistant" as const,
          content: text,
          createdAt: new Date(),
        },
      ];
    });
  }, []);

  function describeTool(evt: SandboxEvent): string {
    const name = evt.toolName ?? "tool";
    const input = evt.toolInput as Record<string, unknown> | undefined;
    if (name === "bash" && input) {
      const desc = typeof input.description === "string" ? input.description : null;
      return desc ? `Running bash — ${desc}` : "Running bash";
    }
    if (name === "skill" && input) {
      const skill = typeof input.skill === "string" ? input.skill : "skill";
      return `Launching ${skill}`;
    }
    return `Running ${name}`;
  }

  function extractThinkingText(evt: SandboxEvent): string {
    const raw = evt.raw as Record<string, unknown> | undefined;
    const content = raw?.content as Array<Record<string, unknown>> | undefined;
    if (Array.isArray(content)) {
      const parts: string[] = [];
      for (const block of content) {
        if (typeof block.thinking === "string") parts.push(block.thinking);
        else if (typeof block.text === "string" && block.type === "thinking") {
          parts.push(block.text);
        }
      }
      if (parts.length) return parts.join("");
    }
    return evt.content ?? "";
  }

  const handleEvent = useCallback(
    (evt: SandboxEvent, assistantAcc: { text: string }) => {
      // Skip echoing the user message that we already rendered optimistically.
      if (evt.type === "user.message") return;

      if (
        evt.type === "agent.tool_use" ||
        evt.type === "span.tool_use_request"
      ) {
        setActivity(describeTool(evt));
        const input = evt.toolInput as Record<string, unknown> | undefined;
        const summary = `▸ ${describeTool(evt)}`;
        const detail =
          input && typeof input.command === "string"
            ? `\n$ ${(input.command as string).slice(0, 400)}`
            : "";
        appendAssistantThinking(`${summary}${detail}\n\n`);
        return;
      }

      if (
        evt.type === "agent.tool_result" ||
        evt.type === "span.tool_use_result"
      ) {
        setActivity(null);
        const raw = evt.raw as Record<string, unknown> | undefined;
        const content = raw?.content as Array<Record<string, unknown>> | undefined;
        let text = "";
        if (Array.isArray(content)) {
          for (const block of content) {
            if (typeof block.text === "string") text += block.text;
          }
        }
        if (text) {
          const trimmed = text.length > 600 ? text.slice(0, 600) + " …" : text;
          appendAssistantThinking(`↳ ${trimmed}\n\n`);
        }
        return;
      }

      if (
        evt.type === "agent.thinking" ||
        evt.type === "span.model_thinking"
      ) {
        const text = extractThinkingText(evt);
        if (text) appendAssistantThinking(text);
        setActivity("Thinking…");
        return;
      }

      if (evt.type === "agent.message" && evt.content) {
        commitAssistantMessage(evt.content);
        assistantAcc.text += (assistantAcc.text ? "\n\n" : "") + evt.content;
        setActivity(null);
        return;
      }

      if (evt.type === "session.error" || evt.type === "agent.error") {
        const raw = evt.raw as Record<string, unknown> | undefined;
        const message =
          (raw?.error as Record<string, unknown> | undefined)?.message ??
          (raw?.message as string | undefined) ??
          "Agent error";
        setError(String(message));
      }
    },
    [commitAssistantMessage, appendAssistantThinking],
  );

  const sendMessage = useCallback(
    (content: string) => {
      if (isStreaming) return;
      setError(null);
      setIsStreaming(true);
      abortedRef.current = false;

      const trimmed = content.trim();
      if (trimmed) appendUserMessage(trimmed);

      (async () => {
        const assistantAcc = { text: "" };
        // Track whether the session has started processing our message.
        // `status === "idle"` from the server is ambiguous right after a
        // create+send — it may mean "idle forever" (done) or "idle because
        // the enqueued message hasn't been picked up yet". We only allow
        // the loop to exit when we have seen the session become running
        // (or at least emit an agent.* event) since we started polling.
        let hasBegunProcessing = false;
        const lifecycle = (text: string) => appendAssistantThinking(`● ${text}\n`);

        let sessionWasJustCreated = false;
        try {
          // 1. Ensure session exists.
          if (!sessionIdRef.current) {
            lifecycle("Connecting to managed agent…");
            setActivity("Connecting…");
            const res = await fetch("/api/sandbox0/chat/start", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ experimentId }),
            });
            if (!res.ok) {
              const j = (await res.json().catch(() => ({}))) as { error?: string };
              throw new Error(j.error ?? `/chat/start: HTTP ${res.status}`);
            }
            const data = (await res.json()) as {
              sessionId: string;
              isNew?: boolean;
            };
            sessionIdRef.current = data.sessionId;
            sessionWasJustCreated = data.isNew === true;
            lifecycle(
              sessionWasJustCreated
                ? `Session created: ${data.sessionId}`
                : `Resumed session: ${data.sessionId}`,
            );
            if (sessionWasJustCreated) {
              lifecycle("Bootstrap command sent — agent will load project state");
            }
          }

          // If we were auto-bootstrapping (empty prompt) and the session was
          // already alive, there's nothing new to poll — exit early rather
          // than rehydrate every past event into the chat.
          if (!trimmed && !sessionWasJustCreated) {
            return;
          }

          // 2. If user typed something, send it. (Empty string just triggers
          // polling so the bootstrap/greeting flows through.)
          if (trimmed) {
            lifecycle("Sending message to agent…");
            const res = await fetch("/api/sandbox0/chat/send", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                sessionId: sessionIdRef.current,
                message: trimmed,
              }),
            });
            if (!res.ok) {
              const j = (await res.json().catch(() => ({}))) as { error?: string };
              throw new Error(j.error ?? `/chat/send: HTTP ${res.status}`);
            }
          }

          setActivity("Waiting for agent…");

          // 3. Poll until done.
          while (!abortedRef.current) {
            const qs = new URLSearchParams({ sessionId: sessionIdRef.current! });
            if (lastEventIdRef.current) qs.set("afterId", lastEventIdRef.current);
            const res = await fetch(`/api/sandbox0/chat/events?${qs}`);
            if (!res.ok) {
              const j = (await res.json().catch(() => ({}))) as { error?: string };
              throw new Error(j.error ?? `/chat/events: HTTP ${res.status}`);
            }
            const { events, done } = (await res.json()) as {
              events: SandboxEvent[];
              status: string;
              done: boolean;
            };
            for (const evt of events) {
              if (seenEventIdsRef.current.has(evt.id)) continue;
              seenEventIdsRef.current.add(evt.id);
              lastEventIdRef.current = evt.id;
              if (
                evt.type === "session.status_running" ||
                evt.type.startsWith("agent.")
              ) {
                hasBegunProcessing = true;
              }
              handleEvent(evt, assistantAcc);
            }
            if (done && hasBegunProcessing) break;
            await new Promise((r) => setTimeout(r, pollIntervalMs));
          }

          setConnectionStatus("connected");
          if (assistantAcc.text) {
            onCompleteRef.current?.(trimmed, assistantAcc.text);
          }
        } catch (err: unknown) {
          const message = err instanceof Error ? err.message : String(err);
          setError(message);
          setConnectionStatus("disconnected");
        } finally {
          setIsStreaming(false);
          setActivity(null);
        }
      })();
    },
    [experimentId, isStreaming, pollIntervalMs, appendUserMessage, handleEvent],
  );

  const abort = useCallback(() => {
    abortedRef.current = true;
    setIsStreaming(false);
  }, []);

  // Reset state when experiment changes.
  useEffect(() => {
    sessionIdRef.current = null;
    lastEventIdRef.current = undefined;
    seenEventIdsRef.current = new Set();
    abortedRef.current = false;
  }, [experimentId]);

  return {
    messages,
    isStreaming,
    error,
    connectionStatus,
    activity,
    sendMessage,
    abort,
  };
}
