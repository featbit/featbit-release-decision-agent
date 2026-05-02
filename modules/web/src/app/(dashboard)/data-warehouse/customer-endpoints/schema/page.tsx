import { readFileSync } from "node:fs";
import path from "node:path";
import Link from "next/link";
import { ArrowLeft, FileText, ExternalLink } from "lucide-react";
import { SchemaMarkdown } from "./schema-markdown";

/**
 * Live-rendered Customer Managed Data Endpoints v1 spec.
 *
 * Reads `docs/customer-managed-data-endpoints-v1.md` from disk at module load.
 * The same file is the source of truth used by every PR's impl decisions, so
 * this page never drifts from the spec — they're literally the same bytes.
 *
 * Production note: the standalone Next.js output doesn't bundle source files
 * outside `.next/`, so the Dockerfile copies `docs/` into the runner image
 * (see Dockerfile near `COPY --from=builder ... ./docs`).
 */

const SPEC_PATH = path.join(process.cwd(), "docs", "customer-managed-data-endpoints-v1.md");
const SPEC_MARKDOWN = readFileSync(SPEC_PATH, "utf8");
const GITHUB_RAW =
  "https://raw.githubusercontent.com/featbit/featbit-release-decision-agent/main/modules/web/docs/customer-managed-data-endpoints-v1.md";

export default function SchemaSpecPage() {
  return (
    <div className="p-6 max-w-4xl mx-auto space-y-6">
      <div className="flex items-center justify-between gap-3">
        <Link
          href="/data-warehouse"
          className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft className="size-3.5" /> Back to Data Warehouse
        </Link>
        <a
          href={GITHUB_RAW}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          Raw on GitHub <ExternalLink className="size-3" />
        </a>
      </div>

      <header className="space-y-1">
        <div className="inline-flex items-center gap-2 rounded-md bg-brand/10 text-brand px-2 py-1 text-[10px] font-medium uppercase tracking-wider">
          <FileText className="size-3" />
          Schema spec — v1
        </div>
        <p className="text-xs text-muted-foreground">
          The contract between FeatBit&apos;s analyser and your customer-hosted
          HTTPS endpoint. Implement this and FeatBit can analyse experiments
          using stats from your own warehouse.
        </p>
      </header>

      <article className="rounded-xl border bg-card p-6">
        <SchemaMarkdown source={SPEC_MARKDOWN} />
      </article>
    </div>
  );
}
