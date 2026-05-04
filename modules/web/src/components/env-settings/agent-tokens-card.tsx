"use client";

import { useCallback, useEffect, useState } from "react";
import { Copy, Check, KeyRound, Trash2, Plus, AlertTriangle } from "lucide-react";
import { useAuth } from "@/lib/featbit-auth/auth-context";
import { authStorage } from "@/lib/featbit-auth/storage";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

function contextHeaders(): Record<string, string> {
  const out: Record<string, string> = {};
  const org = authStorage.getOrganization();
  if (org?.id) out["Organization"] = org.id;
  const profile = authStorage.getProfile();
  if (profile?.workspaceId) out["Workspace"] = profile.workspaceId;
  return out;
}

interface TokenRow {
  id: string;
  prefix: string;
  label: string;
  issuedAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
  createdByUserId: string | null;
}

interface IssuedToken {
  id: string;
  prefix: string;
  label: string;
  issuedAt: string;
  /** Only present on the response from POST /api/agent-tokens. */
  token: string;
}

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toISOString().slice(0, 19).replace("T", " ");
  } catch {
    return iso;
  }
}

export function AgentTokensCard() {
  const { currentProject } = useAuth();
  const projectKey = currentProject?.key ?? null;

  const [rows, setRows] = useState<TokenRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [label, setLabel] = useState("");
  const [issuing, setIssuing] = useState(false);
  const [justIssued, setJustIssued] = useState<IssuedToken | null>(null);
  const [copied, setCopied] = useState(false);

  const refresh = useCallback(async () => {
    if (!projectKey) {
      setRows([]);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/agent-tokens?projectKey=${encodeURIComponent(projectKey)}`,
        { credentials: "same-origin", headers: contextHeaders() },
      );
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? `HTTP ${res.status}`);
      }
      const data = (await res.json()) as TokenRow[];
      setRows(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load tokens");
    } finally {
      setLoading(false);
    }
  }, [projectKey]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  async function issue() {
    if (!projectKey || !label.trim() || issuing) return;
    setIssuing(true);
    setError(null);
    try {
      const res = await fetch("/api/agent-tokens", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...contextHeaders() },
        credentials: "same-origin",
        body: JSON.stringify({ projectKey, label: label.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      setJustIssued(data as IssuedToken);
      setLabel("");
      refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to issue token");
    } finally {
      setIssuing(false);
    }
  }

  async function revoke(id: string) {
    if (!confirm("Revoke this token? Any agent using it will fail on the next request.")) return;
    setError(null);
    try {
      const res = await fetch(`/api/agent-tokens/${id}`, {
        method: "DELETE",
        credentials: "same-origin",
        headers: contextHeaders(),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? `HTTP ${res.status}`);
      }
      refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to revoke token");
    }
  }

  async function copyPlaintext() {
    if (!justIssued) return;
    try {
      await navigator.clipboard.writeText(justIssued.token);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard denied — noop */
    }
  }

  if (!projectKey) {
    return (
      <p className="text-xs italic text-muted-foreground/70">
        Pick a project from the top-right switcher to manage agent tokens.
      </p>
    );
  }

  const activeRows = rows.filter((r) => !r.revokedAt);
  const revokedRows = rows.filter((r) => r.revokedAt);

  return (
    <div className="space-y-4">
      {justIssued && (
        <div className="rounded-md border border-amber-200 bg-amber-50 dark:border-amber-900/50 dark:bg-amber-950/30 p-3 space-y-2">
          <div className="flex items-center gap-2 text-sm font-semibold">
            <AlertTriangle className="size-4 text-amber-600 dark:text-amber-500" />
            Copy this now — it will not be shown again
          </div>
          <div className="flex items-center gap-2">
            <code className="flex-1 font-mono text-[11px] bg-background rounded border px-2 py-1.5 overflow-x-auto whitespace-nowrap">
              {justIssued.token}
            </code>
            <button
              type="button"
              onClick={copyPlaintext}
              className="shrink-0 flex items-center justify-center size-8 rounded-md border text-muted-foreground hover:text-foreground hover:bg-muted transition-colors cursor-pointer"
              title={copied ? "Copied!" : "Copy to clipboard"}
            >
              {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
            </button>
          </div>
          <p className="text-[11px] text-muted-foreground leading-snug">
            Set this as <code className="font-mono">ACCESS_TOKEN</code> in the
            shell where you start{" "}
            <code className="font-mono">npx @featbit/experimentation-claude-code-connector</code>.
            Use the X button below to dismiss this notice.
          </p>
          <div className="flex justify-end">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setJustIssued(null)}
              className="text-xs"
            >
              Dismiss
            </Button>
          </div>
        </div>
      )}

      <div className="flex gap-2">
        <Input
          placeholder="Label (e.g. Bob's MacBook)"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          maxLength={64}
          disabled={issuing}
          onKeyDown={(e) => {
            if (e.key === "Enter") issue();
          }}
        />
        <Button
          onClick={issue}
          disabled={!label.trim() || issuing}
          className="shrink-0"
        >
          <Plus className="size-3.5" />
          {issuing ? "Issuing…" : "Issue token"}
        </Button>
      </div>

      {error && <p className="text-xs text-destructive">{error}</p>}

      {loading ? (
        <p className="text-xs italic text-muted-foreground/70">Loading…</p>
      ) : rows.length === 0 ? (
        <p className="text-xs italic text-muted-foreground/70">
          No tokens yet. Issue one above to use{" "}
          <code className="font-mono">sync.ts</code> from your local Claude
          Code agent.
        </p>
      ) : (
        <div className="rounded-md border divide-y">
          {activeRows.map((row) => (
            <TokenRowView key={row.id} row={row} onRevoke={() => revoke(row.id)} />
          ))}
          {revokedRows.length > 0 && (
            <div className="px-3 py-2 text-[11px] uppercase tracking-wide text-muted-foreground/70">
              Revoked
            </div>
          )}
          {revokedRows.map((row) => (
            <TokenRowView key={row.id} row={row} onRevoke={null} />
          ))}
        </div>
      )}
    </div>
  );
}

function TokenRowView({
  row,
  onRevoke,
}: {
  row: TokenRow;
  onRevoke: (() => void) | null;
}) {
  const isRevoked = !!row.revokedAt;
  return (
    <div
      className={`flex items-center gap-3 px-3 py-2 text-sm ${
        isRevoked ? "opacity-60" : ""
      }`}
    >
      <KeyRound className="size-3.5 text-muted-foreground shrink-0" />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="font-medium truncate">{row.label}</span>
          <code className="font-mono text-[11px] text-muted-foreground">
            {row.prefix}…
          </code>
        </div>
        <div className="text-[11px] text-muted-foreground">
          Issued {fmtDate(row.issuedAt)}
          {" · "}
          Last used {fmtDate(row.lastUsedAt)}
          {isRevoked && ` · Revoked ${fmtDate(row.revokedAt)}`}
        </div>
      </div>
      {onRevoke && (
        <Button
          variant="ghost"
          size="sm"
          onClick={onRevoke}
          className="shrink-0 text-muted-foreground hover:text-destructive"
          title="Revoke"
        >
          <Trash2 className="size-3.5" />
        </Button>
      )}
    </div>
  );
}
