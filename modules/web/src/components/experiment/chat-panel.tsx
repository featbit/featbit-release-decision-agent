"use client";

import { useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  useLocalAgentChat,
  type ChatMessage,
  type ConnectionStatus,
} from "@/hooks/use-local-agent-chat";
import { useSandbox0Chat } from "@/hooks/use-sandbox0-chat";
import { persistMessagesAction } from "@/lib/actions";
import { useAgentMode, type AgentMode } from "@/lib/agent-mode";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  Send,
  Square,
  Bot,
  User,
  AlertCircle,
  WifiOff,
  Loader2,
  CheckCircle2,
  Cloud,
  Laptop,
  Copy,
  Check,
} from "lucide-react";
import type { Message } from "@/generated/prisma";

const LOCAL_AGENT_NPX_COMMAND = "npx @featbit/experimentation-claude-code-connector";

/** Map persisted DB messages to the hook's ChatMessage shape */
function toChat(msg: Message): ChatMessage {
  return {
    id: msg.id,
    role: msg.role as ChatMessage["role"],
    content: msg.content,
    createdAt: new Date(msg.createdAt),
  };
}

// ── Outer ────────────────────────────────────────────────────────────────────

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
  const [mode, setMode] = useAgentMode();

  // Re-mount inner component on mode change so the previous hook fully tears
  // down (probes, abort controllers, accumulated state) before the new one
  // mounts. This keeps the rules-of-hooks invariant intact.
  const inner =
    mode === "local" ? (
      <LocalChatPanel
        key="local"
        mode={mode}
        setMode={setMode}
        experimentId={experimentId}
        initialMessages={initialMessages}
        triggerMessage={triggerMessage}
        onTriggerConsumed={onTriggerConsumed}
      />
    ) : (
      <ManagedChatPanel
        key="managed"
        mode={mode}
        setMode={setMode}
        experimentId={experimentId}
        initialMessages={initialMessages}
        triggerMessage={triggerMessage}
        onTriggerConsumed={onTriggerConsumed}
      />
    );

  return inner;
}

// ── Mode-specific wrappers ───────────────────────────────────────────────────

interface InnerProps {
  mode: AgentMode;
  setMode: (m: AgentMode) => void;
  experimentId: string;
  initialMessages: Message[];
  triggerMessage?: string | null;
  onTriggerConsumed?: () => void;
}

function ManagedChatPanel(props: InnerProps) {
  const chat = useSandbox0Chat({
    experimentId: props.experimentId,
    initialMessages: props.initialMessages.map(toChat),
    onStreamComplete: (userContent, assistantContent) => {
      persistMessagesAction(props.experimentId, userContent, assistantContent);
    },
  });

  return (
    <ChatPanelView
      mode={props.mode}
      setMode={props.setMode}
      experimentId={props.experimentId}
      initialMessagesCount={props.initialMessages.length}
      triggerMessage={props.triggerMessage}
      onTriggerConsumed={props.onTriggerConsumed}
      messages={chat.messages}
      isStreaming={chat.isStreaming}
      error={chat.error}
      connectionStatus={chat.connectionStatus}
      activity={chat.activity}
      sendMessage={chat.sendMessage}
      abort={chat.abort}
      sessionId={chat.sessionId}
      sessionIsNew={chat.sessionIsNew}
      autoBootstrap="always"
    />
  );
}

function LocalChatPanel(props: InnerProps) {
  const chat = useLocalAgentChat({
    experimentId: props.experimentId,
    initialMessages: props.initialMessages.map(toChat),
    // Persistence + DB-delta sync are handled inside the hook itself, not via
    // an onStreamComplete callback like the managed mode — the hook owns the
    // sync cursor and needs to advance it from `persistMessagesAction`'s
    // return value.
  });

  return (
    <ChatPanelView
      mode={props.mode}
      setMode={props.setMode}
      experimentId={props.experimentId}
      initialMessagesCount={props.initialMessages.length}
      triggerMessage={props.triggerMessage}
      onTriggerConsumed={props.onTriggerConsumed}
      messages={chat.messages}
      isStreaming={chat.isStreaming}
      error={chat.error}
      connectionStatus={chat.connectionStatus}
      activity={chat.activity}
      sendMessage={chat.sendMessage}
      abort={chat.abort}
      sessionId={null}
      sessionIsNew={null}
      autoBootstrap="when-empty"
    />
  );
}

// ── Shared view ──────────────────────────────────────────────────────────────

interface ViewProps {
  mode: AgentMode;
  setMode: (m: AgentMode) => void;
  experimentId: string;
  initialMessagesCount: number;
  triggerMessage?: string | null;
  onTriggerConsumed?: () => void;
  messages: ChatMessage[];
  isStreaming: boolean;
  error: string | null;
  connectionStatus: ConnectionStatus;
  activity: string | null;
  sendMessage: (content: string) => void;
  abort: () => void;
  sessionId: string | null;
  sessionIsNew: boolean | null;
  /**
   * Managed mode fires the empty-prompt bootstrap unconditionally so the
   * hook resolves a session id on mount. Local mode only bootstraps when
   * there is no chat history yet, since the SDK creates a fresh session
   * implicitly on the first message.
   */
  autoBootstrap: "always" | "when-empty";
}

function ChatPanelView({
  mode,
  setMode,
  initialMessagesCount,
  triggerMessage,
  onTriggerConsumed,
  messages: liveMessages,
  isStreaming,
  error,
  connectionStatus,
  activity,
  sendMessage,
  abort,
  sessionId,
  sessionIsNew,
  autoBootstrap,
}: ViewProps) {
  const [input, setInput] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const initRef = useRef(false);

  const displayMessages = liveMessages;

  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "auto";
    const lineHeight = parseFloat(getComputedStyle(el).lineHeight) || 20;
    const maxHeight = lineHeight * 5 + 16;
    el.style.height = Math.min(el.scrollHeight, maxHeight) + "px";
  }, [input]);

  const lastContent = displayMessages[displayMessages.length - 1]?.content;
  useEffect(() => {
    scrollRef.current?.scrollTo({
      top: scrollRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [displayMessages.length, lastContent]);

  // Auto-bootstrap on mount.
  useEffect(() => {
    if (initRef.current) return;
    initRef.current = true;
    if (triggerMessage) return; // external trigger will fire its own send
    if (autoBootstrap === "always") {
      sendMessage("");
    } else if (initialMessagesCount === 0) {
      sendMessage("");
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

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
    setTimeout(() => inputRef.current?.focus(), 0);
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  }

  const showLocalSetupCard =
    mode === "local" && connectionStatus === "disconnected" && displayMessages.length === 0;

  return (
    <div className="flex h-full flex-col bg-card/55">
      {/* Mode selector — always visible */}
      <AgentModeSelector mode={mode} setMode={setMode} />

      {/* Connection status bar */}
      <ConnectionStatusBar mode={mode} status={connectionStatus} />

      {/* Managed-mode session indicator */}
      {mode === "managed" && (
        <Sandbox0SessionBar
          sessionId={sessionId}
          sessionIsNew={sessionIsNew}
          error={error}
        />
      )}

      {/* Messages area */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-4">
        {showLocalSetupCard ? (
          <LocalAgentSetupCard />
        ) : displayMessages.length === 0 && !isStreaming ? (
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
                msg.role === "user" && "justify-end",
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
                      : "bg-card text-card-foreground ring-border/80",
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

/* ── Markdown renderer ── */

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

/* ── Mode selector ── */

function AgentModeSelector({
  mode,
  setMode,
}: {
  mode: AgentMode;
  setMode: (m: AgentMode) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-2 border-b border-border/70 bg-background/55 px-3 py-1.5 backdrop-blur">
      <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        Agent
      </span>
      <div className="inline-flex rounded-md border border-border bg-card/90 p-0.5 shadow-sm">
        <button
          type="button"
          onClick={() => setMode("managed")}
          className={cn(
            "inline-flex items-center gap-1.5 rounded px-2 py-0.5 text-[11px] font-medium transition-colors",
            mode === "managed"
              ? "bg-primary text-primary-foreground shadow"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          <Cloud className="size-3" />
          Managed
        </button>
        <button
          type="button"
          onClick={() => setMode("local")}
          className={cn(
            "inline-flex items-center gap-1.5 rounded px-2 py-0.5 text-[11px] font-medium transition-colors",
            mode === "local"
              ? "bg-primary text-primary-foreground shadow"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          <Laptop className="size-3" />
          Local Claude Code
        </button>
      </div>
    </div>
  );
}

/* ── Connection status bar ── */
function ConnectionStatusBar({
  mode,
  status,
}: {
  mode: AgentMode;
  status: ConnectionStatus;
}) {
  const [show, setShow] = useState(status !== "connected");
  const prevStatus = useRef(status);

  useEffect(() => {
    if (prevStatus.current !== "connected" && status === "connected") {
      const timer = setTimeout(() => setShow(false), 2000);
      prevStatus.current = status;
      return () => clearTimeout(timer);
    }
    prevStatus.current = status;
  }, [status]);

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
            : "bg-destructive/10 text-destructive",
      )}
    >
      {status === "checking" ? (
        <>
          <Loader2 className="size-3 animate-spin" />
          <span>Connecting to agent…</span>
        </>
      ) : status === "connected" ? (
        <>
          <CheckCircle2 className="size-3" />
          <span>Connected to agent</span>
        </>
      ) : (
        <>
          <WifiOff className="size-3" />
          <span>
            {mode === "managed"
              ? "Managed agent unavailable — check sandbox0 credentials"
              : "Local connector not running on 127.0.0.1:3100"}
          </span>
        </>
      )}
    </div>
  );
}

/* ── Local-agent setup card ── */

function LocalAgentSetupCard() {
  const [copied, setCopied] = useState(false);

  function copyCommand() {
    navigator.clipboard?.writeText(LOCAL_AGENT_NPX_COMMAND).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }

  return (
    <div className="mx-auto max-w-md rounded-lg border border-border/80 bg-card/90 p-4 shadow-sm">
      <div className="flex items-center gap-2 mb-3">
        <Laptop className="size-4 text-primary" />
        <h3 className="text-sm font-semibold">Connect your local Claude Code</h3>
      </div>
      <ol className="text-xs text-muted-foreground space-y-2 list-decimal pl-4">
        <li>
          Make sure the{" "}
          <a
            href="https://docs.claude.com/claude-code"
            target="_blank"
            rel="noopener noreferrer"
            className="underline text-blue-600 dark:text-blue-400"
          >
            Claude Code CLI
          </a>{" "}
          is installed and you have logged in once with <code className="font-mono text-[11px] rounded bg-foreground/10 px-1 py-0.5">claude</code>.
        </li>
        <li>
          Open a terminal and run the connector:
          <div className="mt-1.5 flex items-center gap-2 rounded-md border border-border bg-background px-2 py-1.5">
            <code className="flex-1 truncate font-mono text-[11px]">
              {LOCAL_AGENT_NPX_COMMAND}
            </code>
            <button
              type="button"
              onClick={copyCommand}
              className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              {copied ? (
                <>
                  <Check className="size-3" />
                  Copied
                </>
              ) : (
                <>
                  <Copy className="size-3" />
                  Copy
                </>
              )}
            </button>
          </div>
        </li>
        <li>
          Leave it running. This panel will detect it on{" "}
          <code className="font-mono text-[11px] rounded bg-foreground/10 px-1 py-0.5">127.0.0.1:3100</code>{" "}
          within a few seconds.
        </li>
      </ol>
    </div>
  );
}

/* ── sandbox0 session bar (always visible on managed mode) ── */
function Sandbox0SessionBar({
  sessionId,
  sessionIsNew,
  error,
}: {
  sessionId: string | null;
  sessionIsNew: boolean | null;
  error: string | null;
}) {
  if (error && !sessionId) {
    return (
      <div className="flex items-center gap-2 border-b border-border/70 bg-destructive/10 px-3 py-1.5 text-[11px] font-medium text-destructive">
        <span className="inline-block size-1.5 rounded-full shrink-0 bg-destructive" />
        <span className="font-medium">Session unavailable</span>
        <span className="truncate">· {error}</span>
      </div>
    );
  }

  if (!sessionId) {
    return (
      <div className="flex items-center gap-2 border-b border-border/70 bg-background/55 px-3 py-1.5 text-[11px] font-medium text-muted-foreground backdrop-blur">
        <Loader2 className="size-3 animate-spin" />
        <span>Connecting to session…</span>
      </div>
    );
  }

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
