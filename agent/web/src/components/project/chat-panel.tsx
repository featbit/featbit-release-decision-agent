"use client";

import { useRef, useState, useTransition } from "react";
import { sendMessageAction } from "@/lib/actions";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Send, Bot, User } from "lucide-react";
import type { Message } from "@/generated/prisma/client";

export function ChatPanel({
  projectId,
  messages,
}: {
  projectId: string;
  messages: Message[];
}) {
  const [input, setInput] = useState("");
  const [isPending, startTransition] = useTransition();
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  function handleSubmit() {
    const content = input.trim();
    if (!content || isPending) return;
    setInput("");
    startTransition(async () => {
      await sendMessageAction(projectId, content);
      // Scroll to bottom after new messages
      setTimeout(() => {
        scrollRef.current?.scrollTo({
          top: scrollRef.current.scrollHeight,
          behavior: "smooth",
        });
      }, 100);
    });
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  }

  return (
    <div className="flex flex-col h-full">
      {/* Messages area */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-4">
        {messages.length === 0 ? (
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
          messages.map((msg) => (
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
        {isPending && (
          <div className="flex gap-3 text-sm">
            <div className="flex shrink-0 items-start pt-0.5">
              <div className="flex size-7 items-center justify-center rounded-full bg-foreground/10">
                <Bot className="size-4" />
              </div>
            </div>
            <div className="bg-muted rounded-lg px-3 py-2">
              <span className="inline-flex gap-1">
                <span className="animate-bounce [animation-delay:0ms]">·</span>
                <span className="animate-bounce [animation-delay:150ms]">
                  ·
                </span>
                <span className="animate-bounce [animation-delay:300ms]">
                  ·
                </span>
              </span>
            </div>
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
            disabled={isPending}
          />
          <Button
            size="sm"
            disabled={!input.trim() || isPending}
            onClick={handleSubmit}
          >
            <Send className="size-4" />
          </Button>
        </div>
        <p className="mt-1.5 text-[10px] text-muted-foreground">
          Press Enter to send · Shift+Enter for new line
        </p>
      </div>
    </div>
  );
}
