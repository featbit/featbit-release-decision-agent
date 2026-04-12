"use client";

import { useEffect, useRef, useState } from "react";
import {
  useSandboxChat,
  type ChatMessage,
  type ConnectionStatus,
} from "@/hooks/use-sandbox-chat";
import { persistMessagesAction } from "@/lib/actions";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Send, Square, Bot, User, AlertCircle, WifiOff, Loader2, CheckCircle2 } from "lucide-react";
import type { Message } from "@/generated/prisma/client";

/** Map persisted DB messages to the hook's ChatMessage shape */
function toChat(msg: Message): ChatMessage {
  return {
    id: msg.id,
    role: msg.role as ChatMessage["role"],
    content: msg.content,
    createdAt: new Date(msg.createdAt),
  };
}

export function ChatPanel({
  experimentId,
  messages: initialMessages,
  triggerMessage,
  onTriggerConsumed,
}: {
  experimentId: string;
  messages: Message[];
  /** When set, auto-sends this message and then calls onTriggerConsumed */
  triggerMessage?: string | null;
  onTriggerConsumed?: () => void;
}) {
  const [input, setInput] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const initRef = useRef(false);

  const { messages: liveMessages, isStreaming, error, connectionStatus, sendMessage, abort } =
    useSandboxChat({
      experimentId,
      initialMessages: initialMessages.map(toChat),
      onStreamComplete: (userContent, assistantContent) => {
        persistMessagesAction(experimentId, userContent, assistantContent);
      },
    });

  // liveMessages already contains the DB history + any new messages
  const displayMessages = liveMessages;

  // Auto-scroll on new messages or streaming content
  const lastContent = displayMessages[displayMessages.length - 1]?.content;
  useEffect(() => {
    scrollRef.current?.scrollTo({
      top: scrollRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [displayMessages.length, lastContent]);

  // Auto-initialize session on mount (empty prompt → triggers greeting)
  useEffect(() => {
    if (initRef.current) return;
    initRef.current = true;
    // Only bootstrap if there are no persisted messages (new experiment)
    if (initialMessages.length === 0) {
      sendMessage("");
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-send external trigger messages (e.g. from the "Analyze" button)
  useEffect(() => {
    if (!triggerMessage) return;
    sendMessage(triggerMessage);
    onTriggerConsumed?.();
    setTimeout(() => inputRef.current?.focus(), 0);
  }, [triggerMessage]); // eslint-disable-line react-hooks/exhaustive-deps

  function handleSubmit() {
    const content = input.trim();
    if (!content || isStreaming) return;
    setInput("");
    sendMessage(content);
    // Re-focus textarea
    setTimeout(() => inputRef.current?.focus(), 0);
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  }

  return (
    <div className="flex flex-col h-full">
      {/* Connection status bar */}
      <ConnectionStatusBar status={connectionStatus} />

      {/* Messages area */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-4">
        {displayMessages.length === 0 && !isStreaming ? (
          <div className="flex flex-col items-center justify-center h-full text-center gap-3 text-muted-foreground">
            <Bot className="size-10 opacity-30" />
            <div className="space-y-1">
              <p className="text-sm font-medium">
                Start a conversation with the agent
              </p>
              <p className="text-xs">
                Describe your goal or what you want to release — the agent will
                guide you through the decision workflow.
              </p>
            </div>
          </div>
        ) : (
          displayMessages.map((msg) => (
            <div
              key={msg.id}
              className={cn(
                "flex gap-3 text-sm",
                msg.role === "user" && "justify-end"
              )}
            >
              {msg.role !== "user" && (
                <div className="flex shrink-0 items-start pt-0.5">
                  <div className="flex size-7 items-center justify-center rounded-full bg-foreground/10">
                    <Bot className="size-4" />
                  </div>
                </div>
              )}
              <div
                className={cn(
                  "max-w-[80%] rounded-lg px-3 py-2 whitespace-pre-wrap",
                  msg.role === "user"
                    ? "bg-primary text-primary-foreground"
                    : msg.role === "system"
                      ? "bg-muted text-muted-foreground text-xs italic"
                      : "bg-muted"
                )}
              >
                {msg.content}
              </div>
              {msg.role === "user" && (
                <div className="flex shrink-0 items-start pt-0.5">
                  <div className="flex size-7 items-center justify-center rounded-full bg-primary/10">
                    <User className="size-4" />
                  </div>
                </div>
              )}
            </div>
          ))
        )}

        {/* Streaming indicator */}
        {isStreaming &&
          (displayMessages.length === 0 ||
            displayMessages[displayMessages.length - 1]?.role !== "assistant") && (
            <div className="flex gap-3 text-sm">
              <div className="flex shrink-0 items-start pt-0.5">
                <div className="flex size-7 items-center justify-center rounded-full bg-foreground/10">
                  <Bot className="size-4" />
                </div>
              </div>
              <div className="bg-muted rounded-lg px-3 py-2">
                <span className="inline-flex gap-1">
                  <span className="animate-bounce [animation-delay:0ms]">·</span>
                  <span className="animate-bounce [animation-delay:150ms]">·</span>
                  <span className="animate-bounce [animation-delay:300ms]">·</span>
                </span>
              </div>
            </div>
          )}

        {/* Error display */}
        {error && (
          <div className="flex items-center gap-2 text-xs text-destructive bg-destructive/10 rounded-lg px-3 py-2">
            <AlertCircle className="size-3.5 shrink-0" />
            <span>{error}</span>
          </div>
        )}
      </div>

      {/* Input area */}
      <div className="border-t p-3">
        <div className="flex items-end gap-2">
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Describe your goal, ask for advice, or tell the agent what to do next…"
            rows={1}
            className="flex-1 resize-none rounded-lg border border-input bg-transparent px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-50"
            disabled={isStreaming}
          />
          {isStreaming ? (
            <Button size="sm" variant="outline" onClick={abort}>
              <Square className="size-4" />
            </Button>
          ) : (
            <Button
              size="sm"
              disabled={!input.trim()}
              onClick={handleSubmit}
            >
              <Send className="size-4" />
            </Button>
          )}
        </div>
        <p className="mt-1.5 text-[10px] text-muted-foreground">
          Press Enter to send · Shift+Enter for new line
        </p>
      </div>
    </div>
  );
}

/* ── Connection status bar ── */
function ConnectionStatusBar({ status }: { status: ConnectionStatus }) {
  const [show, setShow] = useState(status !== "connected");
  const prevStatus = useRef(status);

  useEffect(() => {
    if (prevStatus.current !== "connected" && status === "connected") {
      // Just connected — show briefly then auto-hide
      const timer = setTimeout(() => setShow(false), 2000);
      prevStatus.current = status;
      return () => clearTimeout(timer);
    }
    prevStatus.current = status;
  }, [status]);

  // Always show for non-connected states
  const visible = status !== "connected" || show;
  if (!visible) return null;

  return (
    <div
      className={cn(
        "flex items-center gap-2 px-3 py-1.5 text-xs border-b transition-opacity duration-500",
        status === "checking"
          ? "bg-muted/50 text-muted-foreground"
          : status === "connected"
            ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-400"
            : "bg-destructive/10 text-destructive"
      )}
    >
      {status === "checking" ? (
        <>
          <Loader2 className="size-3 animate-spin" />
          <span>Connecting to agent server…</span>
        </>
      ) : status === "connected" ? (
        <>
          <CheckCircle2 className="size-3" />
          <span>Connected to agent server</span>
        </>
      ) : (
        <>
          <WifiOff className="size-3" />
          <span>Agent server unavailable — start sandbox on port 3001 to enable chat</span>
        </>
      )}
    </div>
  );
}
