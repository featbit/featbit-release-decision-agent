"use client";

import { useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  useSandboxChat,
  type ChatMessage,
  type ConnectionStatus,
} from "@/hooks/use-sandbox-chat";
import { useSandbox0Chat } from "@/hooks/use-sandbox0-chat";
import { persistMessagesAction } from "@/lib/actions";

/**
 * Global agent-backend switch (compile-time, env-driven, never changes at
 * runtime). Defaults to `sandbox0` (Managed-Agents integration). Set
 * `NEXT_PUBLIC_AGENT_BACKEND=classic` to fall back to the classic
 * Claude-Agent-SDK server at `NEXT_PUBLIC_SANDBOX_URL`.
 */
const AGENT_BACKEND =
  (process.env.NEXT_PUBLIC_AGENT_BACKEND ?? "sandbox0") === "classic"
    ? ("classic" as const)
    : ("sandbox0" as const);
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Send, Square, Bot, User, AlertCircle, WifiOff, Loader2, CheckCircle2 } from "lucide-react";
import type { Message } from "@/generated/prisma";

/**
 * Compact markdown renderer for assistant bubbles. Inherits bubble typography
 * and adds sensible defaults for headings, code, lists, and tables.
 */
function AssistantMarkdown({ children }: { children: string }) {
  return (
    <div className="text-sm leading-relaxed space-y-2 [&_p]:my-0 [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:list-decimal [&_ol]:pl-5 [&_li]:my-0.5 [&_h1]:text-base [&_h1]:font-semibold [&_h2]:text-sm [&_h2]:font-semibold [&_h3]:text-sm [&_h3]:font-medium [&_strong]:font-semibold [&_blockquote]:border-l-2 [&_blockquote]:border-border [&_blockquote]:pl-3 [&_blockquote]:text-muted-foreground [&_hr]:my-3 [&_hr]:border-border">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: (props) => (
            <a {...props} target="_blank" rel="noopener noreferrer" className="underline text-blue-600 dark:text-blue-400" />
          ),
          code: ({ className, children, ...props }) => {
            const isBlock = className?.includes("language-");
            return isBlock ? (
              <code className={cn(className, "block")} {...props}>
                {children}
              </code>
            ) : (
              <code className="rounded bg-foreground/10 px-1 py-0.5 text-xs font-mono" {...props}>
                {children}
              </code>
            );
          },
          pre: (props) => (
            <pre className="rounded-md bg-foreground/5 border border-border p-2 overflow-x-auto text-xs font-mono" {...props} />
          ),
          table: (props) => (
            <div className="overflow-x-auto my-2">
              <table className="text-xs border-collapse" {...props} />
            </div>
          ),
          th: (props) => (
            <th className="border border-border px-2 py-1 font-medium bg-foreground/5 text-left" {...props} />
          ),
          td: (props) => (
            <td className="border border-border px-2 py-1" {...props} />
          ),
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}

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

  const chatOpts = {
    experimentId,
    initialMessages: initialMessages.map(toChat),
    onStreamComplete: (userContent: string, assistantContent: string) => {
      persistMessagesAction(experimentId, userContent, assistantContent);
    },
  };
  // `AGENT_BACKEND` is a compile-time constant — the branch is stable for the
  // lifetime of the app, which satisfies the rules-of-hooks invariant even
  // though the static checker can't see it.
  //
  const chat =
    AGENT_BACKEND === "sandbox0"
      // eslint-disable-next-line react-hooks/rules-of-hooks
      ? useSandbox0Chat(chatOpts)
      // eslint-disable-next-line react-hooks/rules-of-hooks
      : useSandboxChat(chatOpts);
  const { messages: liveMessages, isStreaming, error, connectionStatus, activity, sendMessage, abort } = chat;
  const sandbox0Extras = AGENT_BACKEND === "sandbox0" ? (chat as ReturnType<typeof useSandbox0Chat>) : null;
  const sessionId: string | null = sandbox0Extras?.sessionId ?? null;
  const sessionIsNew: boolean | null = sandbox0Extras?.sessionIsNew ?? null;

  // liveMessages already contains the DB history + any new messages
  const displayMessages = liveMessages;

  // Auto-grow the textarea: 1 row default, expand with content up to 5 rows,
  // scroll inside after that. Runs after input changes and after reset.
  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "auto";
    const lineHeight = parseFloat(getComputedStyle(el).lineHeight) || 20;
    const maxHeight = lineHeight * 5 + 16; // 5 rows + vertical padding
    el.style.height = Math.min(el.scrollHeight, maxHeight) + "px";
  }, [input]);

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
    // For sandbox0 backend, fire the empty-prompt path unconditionally so
    // the hook resolves a session id (new or resumed) on open and the UI
    // can display the session status. The hook early-returns on resume
    // without any server-side side effects.
    if (AGENT_BACKEND === "sandbox0" && !triggerMessage) {
      sendMessage("");
      return;
    }
    // Classic backend: only bootstrap if there are no persisted messages
    // AND no external trigger is about to fire (e.g. expert-setup priming
    // message) — otherwise we'd duplicate the greeting.
    if (initialMessages.length === 0 && !triggerMessage) {
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
    <div className="flex h-full flex-col bg-card/55">
      {/* Connection status bar */}
      <ConnectionStatusBar status={connectionStatus} />

      {/* Sandbox0 session indicator — always rendered for the sandbox0
          backend so the user always knows the current session state
          (connecting / resumed / new / errored). */}
      {AGENT_BACKEND === "sandbox0" && (
        <Sandbox0SessionBar
          sessionId={sessionId}
          sessionIsNew={sessionIsNew}
          error={error}
        />
      )}

      {/* Messages area */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-4">
        {displayMessages.length === 0 && !isStreaming ? (
          <div className="flex h-full flex-col items-center justify-center gap-3 text-center text-muted-foreground">
            <div className="flex size-14 items-center justify-center rounded-lg bg-accent text-primary ring-1 ring-primary/15">
              <Bot className="size-7" />
            </div>
            <div className="space-y-1">
              <p className="text-sm font-bold text-foreground">
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
                  <div className="flex size-8 items-center justify-center rounded-lg bg-accent text-primary shadow-sm ring-1 ring-primary/15">
                    <Bot className="size-4.5" />
                  </div>
                </div>
              )}
              <div
                className={cn(
                  "max-w-[82%] rounded-lg px-3.5 py-2.5 shadow-sm shadow-foreground/5 ring-1 ring-transparent",
                  msg.role === "user"
                    ? "bg-primary text-primary-foreground whitespace-pre-wrap ring-primary/20"
                    : msg.role === "system"
                      ? "bg-muted/70 text-muted-foreground text-xs italic whitespace-pre-wrap ring-border/70"
                      : "bg-card text-card-foreground ring-border/80"
                )}
              >
                {msg.role === "assistant" && msg.thinking && (
                  <details
                    open={!msg.content}
                    className="mb-2 text-xs text-muted-foreground group"
                  >
                    <summary className="cursor-pointer select-none hover:text-foreground list-none flex items-center gap-1 [&::-webkit-details-marker]:hidden">
                      <span className="group-open:rotate-90 transition-transform inline-block">▸</span>
                      {msg.content ? "Show thinking" : (activity ?? "Thinking…")}
                    </summary>
                    <div className="mt-1.5 pl-3 border-l-2 border-border/60 whitespace-pre-wrap [overflow-wrap:anywhere] break-all max-h-64 overflow-y-auto opacity-80 font-normal text-[11px] leading-snug font-mono">
                      {msg.thinking}
                    </div>
                  </details>
                )}
                {msg.role === "assistant"
                  ? msg.content && <AssistantMarkdown>{msg.content}</AssistantMarkdown>
                  : msg.content}
              </div>
              {msg.role === "user" && (
                <div className="flex shrink-0 items-start pt-0.5">
                  <div className="flex size-8 items-center justify-center rounded-lg bg-primary/10 text-primary ring-1 ring-primary/15">
                    <User className="size-4" />
                  </div>
                </div>
              )}
            </div>
          ))
        )}

        {/* Streaming indicator — shown whenever the agent is still working.
            Kept visible even when a stream- bubble is growing or a message
            was just committed: the bubbles describe *what* the agent is
            doing, the dots say *it is still going*. */}
        {isStreaming && (
            <div className="flex gap-3 text-sm">
              <div className="flex shrink-0 items-start pt-0.5">
                <div className="flex size-8 items-center justify-center rounded-lg bg-accent text-primary ring-1 ring-primary/15">
                  <Bot className="size-4" />
                </div>
              </div>
              <div className="bg-card rounded-lg px-3.5 py-2.5 flex items-center gap-2 shadow-sm shadow-foreground/5 ring-1 ring-border/80">
                <span className="inline-flex gap-1">
                  <span className="animate-bounce [animation-delay:0ms]">·</span>
                  <span className="animate-bounce [animation-delay:150ms]">·</span>
                  <span className="animate-bounce [animation-delay:300ms]">·</span>
                </span>
                {activity && (
                  <span className="text-xs text-muted-foreground">{activity}</span>
                )}
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
      <div className="border-t border-border/70 bg-background/72 p-3 backdrop-blur-xl">
        <div className="flex items-end gap-2 rounded-lg border border-border/80 bg-card/90 p-2 shadow-sm shadow-foreground/5">
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Describe your goal, ask for advice, or tell the agent what to do next…"
            rows={1}
            className="flex-1 resize-none overflow-y-auto rounded-md border-0 bg-transparent px-2 py-1.5 text-sm leading-5 placeholder:text-muted-foreground focus-visible:outline-none disabled:opacity-50"
            disabled={isStreaming}
          />
          {isStreaming ? (
            <Button size="icon" variant="outline" onClick={abort} className="size-9">
              <Square className="size-4" />
            </Button>
          ) : (
            <Button
              size="icon"
              className="size-9"
              disabled={!input.trim()}
              onClick={handleSubmit}
            >
              <Send className="size-4" />
            </Button>
          )}
        </div>
        <p className="mt-1.5 text-[10px] font-medium text-muted-foreground">
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
        "flex items-center gap-2 border-b border-border/70 px-3 py-1.5 text-xs font-medium transition-opacity duration-500",
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
          <span>
            {AGENT_BACKEND === "sandbox0"
              ? "Agent unavailable — check /api/sandbox0 routes and sandbox0 credentials"
              : "Agent server unavailable — start sandbox on port 3100 to enable chat"}
          </span>
        </>
      )}
    </div>
  );
}

/* ── sandbox0 session bar (always visible on sandbox0 backend) ── */
function Sandbox0SessionBar({
  sessionId,
  sessionIsNew,
  error,
}: {
  sessionId: string | null;
  sessionIsNew: boolean | null;
  error: string | null;
}) {
  // Error state: show red dot + message, takes priority over everything else.
  if (error && !sessionId) {
    return (
      <div className="flex items-center gap-2 border-b border-border/70 bg-destructive/10 px-3 py-1.5 text-[11px] font-medium text-destructive">
        <span className="inline-block size-1.5 rounded-full shrink-0 bg-destructive" />
        <span className="font-medium">Session unavailable</span>
        <span className="truncate">· {error}</span>
      </div>
    );
  }

  // Connecting state: no sessionId yet but no error either.
  if (!sessionId) {
    return (
      <div className="flex items-center gap-2 border-b border-border/70 bg-background/55 px-3 py-1.5 text-[11px] font-medium text-muted-foreground backdrop-blur">
        <Loader2 className="size-3 animate-spin" />
        <span>Connecting to session…</span>
      </div>
    );
  }

  // Connected: green for resumed, blue for new.
  const isResumed = sessionIsNew === false;
  return (
    <div className="flex items-center gap-2 border-b border-border/70 bg-background/55 px-3 py-1.5 text-[11px] font-medium text-muted-foreground backdrop-blur">
      <span
        className={cn(
          "inline-block size-1.5 rounded-full shrink-0",
          isResumed ? "bg-emerald-500" : "bg-sky-500",
        )}
        title={isResumed ? "Resumed session" : "New session"}
      />
      <span className="font-medium">
        {isResumed ? "Resumed session" : "New session"}
      </span>
      <span className="text-muted-foreground/60">·</span>
      <span
        className="font-mono truncate select-all cursor-text"
        title={sessionId}
      >
        {sessionId}
      </span>
    </div>
  );
}
