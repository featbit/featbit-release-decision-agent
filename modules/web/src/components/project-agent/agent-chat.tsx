"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  Send,
  Loader2,
  Sparkles,
  Terminal,
  CheckCircle2,
  Circle,
  Square,
  Bot,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { streamSseEvents } from "./sse-client";
import { cn } from "@/lib/utils";

type Role = "user" | "agent" | "error" | "command" | "todo";

interface ChatMessage {
  id: string;
  role: Role;
  text: string;
  /** Accumulated reasoning/thinking text — attached inline to agent messages */
  thinking?: string;
  /** True once turn_completed fires — collapses the thinking block */
  isFinal?: boolean;
  payload?: Record<string, unknown>;
}

interface AgentChatProps {
  projectKey: string | null;
  userId: string | null;
  autoBootstrap: boolean;
  onBootstrapComplete?: () => void;
}

const AGENT_URL =
  process.env.NEXT_PUBLIC_PROJECT_AGENT_URL ?? "http://localhost:3031";

const SESSION_API = (projectKey: string, userId: string) =>
  `/api/agent-session/${encodeURIComponent(projectKey)}/${encodeURIComponent(userId)}`;

export function AgentChat({
  projectKey,
  userId,
  autoBootstrap,
  onBootstrapComplete,
}: AgentChatProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [sessionLoaded, setSessionLoaded] = useState(false);
  const [draft, setDraft] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [activity, setActivity] = useState<string | null>(null);
  const hasBootstrappedRef = useRef(false);
  const abortRef = useRef<AbortController | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const codexThreadIdRef = useRef<string | null>(null);

  // Load session (messages + codexThreadId) from DB on mount.
  useEffect(() => {
    if (!projectKey || !userId) { setSessionLoaded(true); return; }
    fetch(SESSION_API(projectKey, userId))
      .then((r) => (r.ok ? r.json() : null))
      .then((data: { codexThreadId?: string; messages?: ChatMessage[] } | null) => {
        if (data?.codexThreadId) codexThreadIdRef.current = data.codexThreadId;
        if (data?.messages?.length) setMessages(data.messages);
      })
      .catch(() => {})
      .finally(() => setSessionLoaded(true));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectKey, userId]);

  const saveSession = useCallback(
    (msgs: ChatMessage[]) => {
      if (!projectKey || !userId) return;
      void fetch(SESSION_API(projectKey, userId), {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: msgs }),
      });
    },
    [projectKey, userId]
  );

  const send = useCallback(
    async (text: string) => {
      if (!projectKey) return;
      if (streaming) return;

      const userMsg: ChatMessage | null = text.trim()
        ? { id: crypto.randomUUID(), role: "user", text }
        : null;
      if (userMsg) setMessages((prev) => [...prev, userMsg]);

      const agentMsgId = crypto.randomUUID();
      setMessages((prev) => [
        ...prev,
        { id: agentMsgId, role: "agent", text: "", thinking: "" },
      ]);
      setStreaming(true);
      setActivity("Thinking…");

      const controller = new AbortController();
      abortRef.current = controller;

      // Insert a structured item (command/todo) just before the pending agent
      // bubble so it appears in arrival order.
      const insertBeforeAgent = (msg: ChatMessage) => {
        setMessages((prev) => {
          const idx = prev.findIndex((m) => m.id === agentMsgId);
          return idx === -1
            ? [...prev, msg]
            : [...prev.slice(0, idx), msg, ...prev.slice(idx)];
        });
      };

      // Intermediate agent_message items accumulate here; on turn_completed
      // the last one is promoted to the visible response and earlier ones
      // stay in the collapsed thinking block.
      const agentMsgBuffer: string[] = [];
      let turnCompleted = false;

      const promoteFinalMessage = () => {
        if (agentMsgBuffer.length === 0) return;
        const finalText = agentMsgBuffer[agentMsgBuffer.length - 1];
        const thinkingItems = agentMsgBuffer.slice(0, -1);
        const thinkingText =
          thinkingItems.length > 0 ? thinkingItems.join("\n\n") : undefined;
        setMessages((prev) =>
          prev.map((m) =>
            m.id === agentMsgId
              ? { ...m, text: finalText, thinking: thinkingText, isFinal: true }
              : m
          )
        );
      };

      try {
        for await (const ev of streamSseEvents(
          `${AGENT_URL}/query`,
          {
            prompt: text,
            projectKey,
            userId: userId ?? undefined,
            codexThreadId: codexThreadIdRef.current ?? undefined,
          },
          controller.signal
        )) {
          if (ev.event === "thread_started") {
            const tid = (ev.data as { thread_id?: string })?.thread_id;
            if (tid && projectKey && userId) {
              codexThreadIdRef.current = tid;
              void fetch(SESSION_API(projectKey, userId), {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ codexThreadId: tid }),
              });
            }
          } else if (ev.event === "item_updated") {
            const item = (ev.data as { item?: Record<string, unknown> })?.item;
            if (
              item?.type === "agent_message" &&
              typeof item?.text === "string" &&
              item.text
            ) {
              setActivity(null);
              // Stream current (not-yet-completed) item into the thinking
              // preview so the user sees progress before turn_completed fires.
              const preview = item.text as string;
              setMessages((prev) =>
                prev.map((m) =>
                  m.id === agentMsgId
                    ? {
                        ...m,
                        text: "",
                        thinking: [...agentMsgBuffer, preview].join("\n\n"),
                      }
                    : m
                )
              );
            }
          } else if (ev.event === "item_completed") {
            const item = (ev.data as { item?: Record<string, unknown> })?.item;
            const type = typeof item?.type === "string" ? item.type : "";

            if (type === "agent_message" && typeof item?.text === "string") {
              setActivity(null);
              agentMsgBuffer.push(item.text as string);
              // All confirmed items go into thinking; text stays empty until
              // turn_completed so the thinking block stays open.
              setMessages((prev) =>
                prev.map((m) =>
                  m.id === agentMsgId
                    ? { ...m, text: "", thinking: agentMsgBuffer.join("\n\n") }
                    : m
                )
              );
            } else if (type === "reasoning") {
              const raw = item?.content;
              const reasoningText =
                typeof raw === "string"
                  ? raw
                  : Array.isArray(raw)
                  ? raw
                      .map(
                        (c: unknown) => (c as { text?: string }).text ?? ""
                      )
                      .join("")
                  : "";
              if (reasoningText) {
                setMessages((prev) =>
                  prev.map((m) =>
                    m.id === agentMsgId
                      ? { ...m, thinking: (m.thinking ?? "") + reasoningText }
                      : m
                  )
                );
              }
            } else if (type === "command_execution") {
              const cmd =
                typeof item?.command === "string" ? item.command : "";
              if (cmd) {
                setActivity(`Running: ${cmd.slice(0, 40)}${cmd.length > 40 ? "…" : ""}`);
              }
            }
          } else if (ev.event === "turn_completed") {
            turnCompleted = true;
            promoteFinalMessage();
          } else if (ev.event === "error" || ev.event === "turn_failed") {
            const payload = ev.data as {
              message?: string;
              error?: { message?: string };
            };
            const msg =
              payload?.message ??
              payload?.error?.message ??
              "project-agent reported an error.";
            setMessages((prev) => [
              ...prev.filter((m) => !(m.id === agentMsgId && !m.text)),
              { id: crypto.randomUUID(), role: "error", text: msg },
            ]);
          }
        }
      } catch (err) {
        if ((err as { name?: string }).name !== "AbortError") {
          const msg = err instanceof Error ? err.message : String(err);
          setMessages((prev) => [
            ...prev,
            { id: crypto.randomUUID(), role: "error", text: msg },
          ]);
        }
      } finally {
        if (!turnCompleted) promoteFinalMessage();
        setMessages((prev) => {
          const cleaned = prev.filter(
            (m) => !(m.id === agentMsgId && !m.text && !m.thinking)
          );
          saveSession(cleaned);
          return cleaned;
        });
        setStreaming(false);
        setActivity(null);
        abortRef.current = null;
      }
    },
    [projectKey, userId, streaming, saveSession]
  );

  useEffect(() => {
    if (!autoBootstrap || !projectKey || !sessionLoaded) return;
    if (hasBootstrappedRef.current) return;
    if (messages.length > 0) return; // history restored — skip bootstrap
    hasBootstrappedRef.current = true;
    onBootstrapComplete?.();
    void send("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoBootstrap, projectKey, sessionLoaded]);

  useEffect(() => {
    return () => abortRef.current?.abort();
  }, []);

  useEffect(() => {
    scrollRef.current?.scrollTo({
      top: scrollRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [messages]);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const text = draft.trim();
    if (!text || streaming) return;
    setDraft("");
    void send(text);
  };

  if (!projectKey) {
    return (
      <div className="flex-1 flex items-center justify-center p-6 text-center text-sm text-muted-foreground">
        Select a FeatBit project first — project-agent works per project.
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col min-h-0">
      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto px-4 py-3 space-y-3"
      >
        {messages.length === 0 && !streaming && (
          <div className="text-sm text-muted-foreground flex items-start gap-2 rounded-lg border border-dashed p-3">
            <Sparkles className="size-4 shrink-0 mt-0.5" />
            <span>
              Ask project-agent anything about this project, or just say
              &ldquo;hi&rdquo; to run through onboarding.
            </span>
          </div>
        )}
        {messages.map((m) => (
          <MessageBubble
            key={m.id}
            message={m}
            activity={activity}
            isStreaming={streaming}
          />
        ))}
        {/* Typing dots: shown while streaming but no content visible yet */}
        {streaming && !messages.some((m) => m.role === "agent" && (m.text || m.thinking)) && (
          <div className="flex gap-3 text-sm">
            <div className="flex shrink-0 items-start pt-0.5">
              <div className="flex size-7 items-center justify-center rounded-full bg-foreground/10">
                <Bot className="size-4" />
              </div>
            </div>
            <div className="bg-muted rounded-lg px-3 py-2 flex items-center gap-2">
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
      </div>
      <form
        onSubmit={submit}
        className="border-t p-3 flex items-end gap-2 bg-background"
      >
        <Textarea
          value={draft}
          onChange={(e) => {
            setDraft(e.target.value);
            // Auto-grow: reset height first so shrinking works, then clamp to 5 lines.
            const el = e.target;
            el.style.height = "0";
            el.style.height = `${Math.min(el.scrollHeight, 5 * 24)}px`;
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              submit(e);
            }
          }}
          placeholder="Message project-agent…"
          rows={1}
          className="min-h-0 resize-none overflow-y-auto"
          style={{ height: "36px" }}
          disabled={streaming}
        />
        {streaming ? (
          <Button
            type="button"
            size="icon"
            variant="outline"
            onClick={() => abortRef.current?.abort()}
          >
            <Square className="size-4" />
          </Button>
        ) : (
          <Button type="submit" size="icon" disabled={!draft.trim()}>
            <Send className="size-4" />
          </Button>
        )}
      </form>
    </div>
  );
}

// ── Message rendering ────────────────────────────────────────────────────────

function MessageBubble({
  message,
  activity,
  isStreaming,
}: {
  message: ChatMessage;
  activity: string | null;
  isStreaming: boolean;
}) {
  if (message.role === "command") {
    return <CommandBubble payload={message.payload} />;
  }
  if (message.role === "todo") {
    return <TodoBubble payload={message.payload} />;
  }

  const isUser = message.role === "user";
  const isError = message.role === "error";

  if (isUser || isError) {
    return (
      <div className={cn("flex", isUser ? "justify-end" : "justify-start")}>
        <div
          className={cn(
            "rounded-lg px-3 py-2 text-sm max-w-[85%] whitespace-pre-wrap",
            isUser && "bg-primary text-primary-foreground",
            isError &&
              "bg-destructive/10 text-destructive border border-destructive/30"
          )}
        >
          {message.text}
        </div>
      </div>
    );
  }

  // Agent message with optional inline thinking
  return (
    <div className="flex gap-3">
      <div className="flex shrink-0 items-start pt-0.5">
        <div className="flex size-7 items-center justify-center rounded-full bg-foreground/10">
          <Bot className="size-4" />
        </div>
      </div>
      <div className="max-w-[85%] rounded-lg px-3 py-2 bg-muted text-sm flex-1">
        {message.thinking && (
          <details
            open={!message.isFinal}
            className="mb-2 text-xs text-muted-foreground group"
          >
            <summary className="cursor-pointer select-none hover:text-foreground list-none flex items-center gap-1 [&::-webkit-details-marker]:hidden">
              <span className="group-open:rotate-90 transition-transform inline-block">
                ▸
              </span>
              {message.text ? (
                "Show thinking"
              ) : (
                <>
                  {activity ?? "Thinking…"}
                  {isStreaming && (
                    <Loader2 className="size-3 animate-spin ml-1 inline-block" />
                  )}
                </>
              )}
            </summary>
            <div className="mt-1.5 pl-3 border-l-2 border-border/60 whitespace-pre-wrap opacity-80 font-normal">
              {message.thinking}
            </div>
          </details>
        )}
        {message.text ? (
          <AgentMarkdown>{message.text}</AgentMarkdown>
        ) : !message.thinking ? (
          <span className="text-muted-foreground italic">…</span>
        ) : null}
      </div>
    </div>
  );
}

function AgentMarkdown({ children }: { children: string }) {
  return (
    <div className="leading-relaxed space-y-2 [&_p]:my-0 [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:list-decimal [&_ol]:pl-5 [&_li]:my-0.5 [&_h1]:text-base [&_h1]:font-semibold [&_h2]:text-sm [&_h2]:font-semibold [&_h3]:text-sm [&_h3]:font-medium [&_strong]:font-semibold [&_blockquote]:border-l-2 [&_blockquote]:border-border [&_blockquote]:pl-3 [&_blockquote]:text-muted-foreground [&_hr]:my-3">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: (props) => (
            <a
              {...props}
              target="_blank"
              rel="noopener noreferrer"
              className="underline text-blue-600 dark:text-blue-400"
            />
          ),
          code: ({ className, children: codeChildren, ...props }) => {
            const isBlock = className?.includes("language-");
            return isBlock ? (
              <code className={cn(className, "block")} {...props}>
                {codeChildren}
              </code>
            ) : (
              <code
                className="rounded bg-foreground/10 px-1 py-0.5 text-xs font-mono"
                {...props}
              >
                {codeChildren}
              </code>
            );
          },
          pre: (props) => (
            <pre
              className="rounded-md bg-foreground/5 border border-border p-2 overflow-x-auto text-xs font-mono"
              {...props}
            />
          ),
          table: (props) => (
            <div className="overflow-x-auto my-2">
              <table className="text-xs border-collapse" {...props} />
            </div>
          ),
          th: (props) => (
            <th
              className="border border-border px-2 py-1 font-medium bg-foreground/5 text-left"
              {...props}
            />
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

function CommandBubble({ payload }: { payload?: Record<string, unknown> }) {
  if (!payload) return null;
  const command =
    typeof payload.command === "string" ? payload.command : "";
  const output =
    typeof payload.output === "string"
      ? payload.output
      : typeof payload.stdout === "string"
      ? payload.stdout
      : "";
  const exitCode =
    typeof payload.exit_code === "number"
      ? payload.exit_code
      : typeof payload.exitCode === "number"
      ? payload.exitCode
      : null;

  return (
    <div className="flex justify-start w-full">
      <div className="max-w-[85%] w-full rounded-md border bg-zinc-950 text-zinc-100 text-xs font-mono overflow-hidden">
        <div className="flex items-center gap-2 px-3 py-1.5 border-b border-zinc-800 bg-zinc-900">
          <Terminal className="size-3 text-zinc-400 shrink-0" />
          <span className="text-zinc-300 truncate flex-1">{command}</span>
          {exitCode !== null && (
            <span
              className={cn(
                "shrink-0",
                exitCode === 0 ? "text-green-400" : "text-red-400"
              )}
            >
              exit {exitCode}
            </span>
          )}
        </div>
        {output && (
          <pre className="px-3 py-2 text-zinc-300 whitespace-pre-wrap overflow-x-auto max-h-40">
            {output}
          </pre>
        )}
      </div>
    </div>
  );
}

type TodoItem = { content?: string; status?: string };

function TodoBubble({ payload }: { payload?: Record<string, unknown> }) {
  if (!payload) return null;
  const items = Array.isArray(payload.items) ? (payload.items as TodoItem[]) : [];
  if (items.length === 0) return null;

  return (
    <div className="flex justify-start">
      <div className="max-w-[85%] rounded-lg border bg-muted/30 px-3 py-2 space-y-1.5">
        {items.map((item, i) => (
          <div key={i} className="flex items-start gap-2">
            <span className="shrink-0 mt-0.5">
              {item.status === "done" ? (
                <CheckCircle2 className="size-3.5 text-green-500" />
              ) : item.status === "in_progress" ? (
                <Loader2 className="size-3.5 text-blue-500 animate-spin" />
              ) : (
                <Circle className="size-3.5 text-muted-foreground" />
              )}
            </span>
            <span
              className={cn(
                "text-xs",
                item.status === "done" && "line-through text-muted-foreground"
              )}
            >
              {item.content ?? ""}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
