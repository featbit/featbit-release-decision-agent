"use client";

import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/lib/featbit-auth/auth-context";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Cable, Plus, Pencil, AlertCircle, Globe } from "lucide-react";
import { CustomerEndpointFormDialog } from "./customer-endpoint-form-dialog";
import { SecretRevealDialog } from "./secret-reveal-dialog";
import type { ProviderPublic, ProviderWithSecret } from "./types";

/**
 * Customer Managed Data Endpoints section. Lives below the top-level data
 * warehouse cards on /data-warehouse. Manages the full provider lifecycle:
 * list, add, edit, rotate-secret, delete.
 *
 * The signing secret is shown in plaintext exactly once after create or
 * rotate via SecretRevealDialog — never persisted in component state past
 * the user's "I've saved it" acknowledgement.
 */
export function CustomerEndpointsSection() {
  const { currentProject, isReady } = useAuth();
  const projectKey = currentProject?.key ?? null;

  const [providers, setProviders] = useState<ProviderPublic[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [formMode, setFormMode] = useState<
    | { kind: "add" }
    | { kind: "edit"; provider: ProviderPublic }
    | null
  >(null);

  const [revealedSecret, setRevealedSecret] = useState<{
    secret: string;
    context: "created" | "rotated";
  } | null>(null);

  const load = useCallback(async () => {
    if (!projectKey) return;
    setLoading(true);
    setLoadError(null);
    try {
      const res = await fetch(
        `/api/projects/${encodeURIComponent(projectKey)}/customer-endpoints`,
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = (await res.json()) as ProviderPublic[];
      setProviders(json);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [projectKey]);

  useEffect(() => {
    if (isReady) load();
  }, [isReady, load]);

  function handleCreated(created: ProviderWithSecret) {
    const { signingSecretPlaintext, ...rest } = created;
    setProviders((prev) => [...prev, rest]);
    setRevealedSecret({ secret: signingSecretPlaintext, context: "created" });
  }

  function handleUpdated(updated: ProviderPublic) {
    setProviders((prev) => prev.map((p) => (p.id === updated.id ? updated : p)));
  }

  function handleRotated(rotated: ProviderWithSecret) {
    const { signingSecretPlaintext, ...rest } = rotated;
    setProviders((prev) => prev.map((p) => (p.id === rotated.id ? rest : p)));
    setRevealedSecret({ secret: signingSecretPlaintext, context: "rotated" });
  }

  function handleDeleted(id: string) {
    setProviders((prev) => prev.filter((p) => p.id !== id));
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  if (!isReady) return null;

  if (!projectKey) {
    return (
      <div className="rounded-xl border border-dashed p-4 text-sm text-muted-foreground">
        Select a project to manage customer endpoints.
      </div>
    );
  }

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <div className="space-y-0.5">
          <h2 className="text-base font-bold tracking-tight">
            Customer Managed Data Endpoints
          </h2>
          <p className="text-xs text-muted-foreground">
            Project-level providers. Each endpoint serves experiment statistics from your warehouse on demand.
          </p>
        </div>
        <Button
          type="button"
          size="sm"
          onClick={() => setFormMode({ kind: "add" })}
          disabled={loading}
        >
          <Plus className="size-3.5" /> Add provider
        </Button>
      </div>

      {loading && (
        <div className="space-y-2">
          <Skeleton className="h-16 w-full rounded-xl" />
          <Skeleton className="h-16 w-full rounded-xl" />
        </div>
      )}

      {!loading && loadError && (
        <div className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-xs text-destructive flex items-center gap-2">
          <AlertCircle className="size-3.5" /> Couldn&apos;t load providers: {loadError}
        </div>
      )}

      {!loading && !loadError && providers.length === 0 && (
        <div className="rounded-xl border border-dashed p-6 text-center space-y-2">
          <Cable className="size-6 mx-auto text-muted-foreground" />
          <p className="text-sm font-medium">No customer endpoints yet</p>
          <p className="text-xs text-muted-foreground max-w-md mx-auto">
            Connect your first warehouse by registering an HTTPS endpoint that returns experiment statistics in the FeatBit v1 schema.
          </p>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => setFormMode({ kind: "add" })}
            className="mt-2"
          >
            <Plus className="size-3.5" /> Add your first provider
          </Button>
        </div>
      )}

      {!loading && !loadError && providers.length > 0 && (
        <div className="surface-panel overflow-hidden rounded-xl divide-y divide-border/70">
          {providers.map((p) => (
            <div key={p.id} className="flex items-center gap-3 p-3">
              <div className="flex size-8 shrink-0 items-center justify-center rounded-md bg-brand/10 text-brand">
                <Globe className="size-4" />
              </div>
              <div className="min-w-0 flex-1 space-y-0.5">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-[15px] font-bold tracking-tight truncate">{p.name}</span>
                  {p.hasSecondarySecret && (
                    <Badge className="bg-amber-100 text-amber-900 border-0 text-[10px]">
                      Rotation grace
                    </Badge>
                  )}
                </div>
                <div className="text-xs text-muted-foreground truncate font-mono">
                  {p.baseUrl}
                </div>
                <div className="text-[11px] text-muted-foreground flex items-center gap-2 flex-wrap">
                  <span>secret <code className="font-mono">{p.signingSecretMasked}</code></span>
                  <span>·</span>
                  <span>timeout {p.timeoutMs}ms</span>
                  <span>·</span>
                  <span>schema v{p.schemaVersion}</span>
                </div>
              </div>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setFormMode({ kind: "edit", provider: p })}
                className="shrink-0"
              >
                <Pencil className="size-3.5" /> Edit
              </Button>
            </div>
          ))}
        </div>
      )}

      {formMode && (
        <CustomerEndpointFormDialog
          open
          mode={formMode}
          projectKey={projectKey}
          onClose={() => setFormMode(null)}
          onCreated={handleCreated}
          onUpdated={handleUpdated}
          onRotated={handleRotated}
          onDeleted={handleDeleted}
        />
      )}

      <SecretRevealDialog
        open={revealedSecret !== null}
        secret={revealedSecret?.secret ?? null}
        context={revealedSecret?.context ?? "created"}
        onClose={() => setRevealedSecret(null)}
      />
    </section>
  );
}
