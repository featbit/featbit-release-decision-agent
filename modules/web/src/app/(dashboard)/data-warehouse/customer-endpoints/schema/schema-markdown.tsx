"use client";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { cn } from "@/lib/utils";

/**
 * Docs-style markdown renderer. Heavier typography than the chat-bubble
 * `AssistantMarkdown` in chat-panel.tsx — bigger headings, more whitespace,
 * tables that take the available width.
 */
export function SchemaMarkdown({ source }: { source: string }) {
  return (
    <div className="prose-spec text-sm leading-relaxed">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          h1: (p) => <h1 className="text-xl font-bold tracking-tight mt-6 mb-3 first:mt-0" {...p} />,
          h2: (p) => <h2 className="text-base font-bold tracking-tight mt-6 mb-2 border-b border-border/60 pb-1" {...p} />,
          h3: (p) => <h3 className="text-sm font-bold tracking-tight mt-4 mb-1.5" {...p} />,
          h4: (p) => <h4 className="text-xs font-bold tracking-tight mt-3 mb-1 uppercase text-muted-foreground" {...p} />,
          p:  (p) => <p className="my-2" {...p} />,
          ul: (p) => <ul className="list-disc pl-5 my-2 space-y-1" {...p} />,
          ol: (p) => <ol className="list-decimal pl-5 my-2 space-y-1" {...p} />,
          li: (p) => <li className="leading-relaxed" {...p} />,
          a:  (p) => (
            <a
              {...p}
              target={p.href?.startsWith("http") ? "_blank" : undefined}
              rel={p.href?.startsWith("http") ? "noopener noreferrer" : undefined}
              className="underline text-blue-600 dark:text-blue-400 hover:text-blue-700"
            />
          ),
          blockquote: (p) => (
            <blockquote
              className="border-l-2 border-amber-400 bg-amber-50/50 dark:bg-amber-950/20 pl-3 pr-2 py-2 my-3 text-xs"
              {...p}
            />
          ),
          hr:  () => <hr className="my-6 border-border" />,
          strong: (p) => <strong className="font-semibold" {...p} />,
          code: ({ className, children, ...props }) => {
            const isBlock = className?.includes("language-");
            return isBlock ? (
              <code className={cn(className, "block")} {...props}>
                {children}
              </code>
            ) : (
              <code className="rounded bg-foreground/10 px-1.5 py-0.5 text-[12px] font-mono" {...props}>
                {children}
              </code>
            );
          },
          pre: (p) => (
            <pre
              className="rounded-md bg-muted/40 border border-border p-3 overflow-x-auto text-[12px] font-mono leading-relaxed my-3"
              {...p}
            />
          ),
          table: (p) => (
            <div className="overflow-x-auto my-3">
              <table className="text-xs border-collapse w-full" {...p} />
            </div>
          ),
          th: (p) => (
            <th className="border border-border px-2 py-1.5 font-semibold bg-muted/40 text-left align-top" {...p} />
          ),
          td: (p) => (
            <td className="border border-border px-2 py-1.5 align-top leading-relaxed" {...p} />
          ),
        }}
      >
        {source}
      </ReactMarkdown>
    </div>
  );
}
