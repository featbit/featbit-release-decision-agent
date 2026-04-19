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
  payload?: Record<string, unknown>;
}

interface AgentChatProps {
  projectKey: string | null;
  userId: string | null;
  autoBootstrap: boolean;
}

const AGENT_URL =
  process.env.NEXT_PUBLIC_PROJECT_AGENT_URL ?? "http://localhost:3031";

export function AgentChat({
  projectKey,
  userId,
  autoBootstrap,
}: AgentChatProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [activity, setActivity] = useState<string | null>(null);
  const hasBootstrappedRef = useRef(false);
  const abortRef = useRef<AbortController | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);

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

      try {
        for await (const ev of streamSseEvents(
          `${AGENT_URL}/query`,
          { prompt: text, projectKey, userId: userId ?? undefined },
          controller.signal
        )) {
          if (ev.event === "item_updated") {
            // Progressive text streaming — replace current agent bubble text
            // with the latest partial state from the server.
            const item = (ev.data as { item?: Record<string, unknown> })?.item;
            if (
              item?.type === "agent_message" &&
              typeof item?.text === "string" &&
              item.text
            ) {
              setActivity(null);
              setMessages((prev) =>
                prev.map((m) =>
                  m.id === agentMsgId ? { ...m, text: item.text as string } : m
                )
              );
            }
          } else if (ev.event === "item_completed") {
            const item = (ev.data as { item?: Record<string, unknown> })?.item;
            const type = typeof item?.type === "string" ? item.type : "";

            if (type === "agent_message" && typeof item?.text === "string") {
              // Each agent_message item_completed may be a separate turn
              // segment — append with spacing so multi-part replies flow
              // naturally. item_updated already streamed partial text for the
              // same segment, so replace-in-place (no extra newlines).
              setActivity(null);
              const newText = item.text as string;
              setMessages((prev) =>
                prev.map((m) => {
                  if (m.id !== agentMsgId) return m;
                  // If item_updated already streamed this segment's text,
                  // the streaming text equals or starts with newText —
                  // just confirm it in place. Otherwise append as a new segment.
                  const alreadyStreamed =
                    m.text && m.text.endsWith(newText);
                  return {
                    ...m,
                    text: alreadyStreamed
                      ? m.text
                      : m.text
                      ? `${m.text}\n\n${newText}`
                      : newText,
                  };
                })
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
                insertBeforeAgent({
                  id: crypto.randomUUID(),
                  role: "command",
                  text: cmd,
                  payload: item as Record<string, unknown>,
                });
              }
            } else if (type === "todo_list") {
              const items = Array.isArray(item?.items) ? item.items : [];
              if (items.length > 0) {
                insertBeforeAgent({
                  id: crypto.randomUUID(),
                  role: "todo",
                  text: "",
                  payload: item as Record<string, unknown>,
                });
              }
            }
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
        // Remove empty agent placeholder if no content arrived
        setMessages((prev) =>
          prev.filter((m) => !(m.id === agentMsgId && !m.text))
        );
        setStreaming(false);
        setActivity(null);
        abortRef.current = null;
      }
    },
    [projectKey, userId, streaming]
  );

  useEffect(() => {
    if (!autoBootstrap || !projectKey) return;
    if (hasBootstrappedRef.current) return;
    hasBootstrappedRef.current = true;
    void send("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoBootstrap, projectKey]);

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
        {/* Typing dots: shown while streaming but no agent bubble text yet */}
        {streaming && !messages.some((m) => m.role === "agent" && m.text) && (
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
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              submit(e);
            }
          }}
          placeholder="Message project-agent…"
          rows={1}
          className="min-h-0 resize-none"
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
            open={!message.text}
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
