"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useAuth } from "@/lib/featbit-auth/auth-context";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Database,
  Cable,
  CheckCircle2,
  ExternalLink,
  Plus,
  Pencil,
  AlertCircle,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { CustomerEndpointFormDialog } from "./customer-endpoint-form-dialog";
import { SecretRevealDialog } from "./secret-reveal-dialog";
import { RequestProviderDialog } from "./request-provider-dialog";
import { AddDataSourceChooserDialog } from "./add-data-source-chooser-dialog";
import type { ProviderPublic, ProviderWithSecret } from "./types";

type FilterKind = "all" | "featbit-managed" | "customer-endpoint";

const FILTERS: { value: FilterKind; label: string }[] = [
  { value: "all",                label: "All" },
  { value: "featbit-managed",    label: "FeatBit Managed" },
  { value: "customer-endpoint",  label: "Customer Endpoints" },
];

export function DataWarehouseClient() {
  const { currentProject, isReady } = useAuth();
  const projectKey = currentProject?.key ?? null;

  const [providers, setProviders] = useState<ProviderPublic[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [filter, setFilter] = useState<FilterKind>("all");

  // Dialog orchestration. Only one of these is open at a time.
  const [chooserOpen,        setChooserOpen]        = useState(false);
  const [requestExtOpen,     setRequestExtOpen]     = useState(false);
  const [customerFormMode, setCustomerFormMode] = useState<
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
      setProviders((await res.json()) as ProviderPublic[]);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [projectKey]);

  useEffect(() => {
    if (isReady) load();
  }, [isReady, load]);

  // Counts shown in filter chip labels.
  const counts = useMemo(
    () => ({
      "all":               providers.length + 1,
      "featbit-managed":   1,
      "customer-endpoint": providers.length,
    }),
    [providers.length],
  );

  const showFeatBitRow  = filter === "all" || filter === "featbit-managed";
  const showCustomerRows = filter === "all" || filter === "customer-endpoint";

  // ── Dialog handlers ───────────────────────────────────────────────────────

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

  // ── Render ────────────────────────────────────────────────────────────────

  if (!isReady) return null;

  if (!projectKey) {
    return (
      <div className="rounded-xl border border-dashed p-4 text-sm text-muted-foreground">
        Select a project to manage data warehouses.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* Filter chips + Add button */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-1.5 flex-wrap">
          {FILTERS.map((f) => (
            <button
              key={f.value}
              type="button"
              onClick={() => setFilter(f.value)}
              className={cn(
                "rounded-md border px-2.5 py-1 text-xs font-medium transition-colors",
                filter === f.value
                  ? "border-brand bg-brand/10 text-brand"
                  : "border-border hover:bg-muted text-foreground/80",
              )}
            >
              {f.label} <span className="opacity-60">({counts[f.value]})</span>
            </button>
          ))}
        </div>
        <Button
          type="button"
          size="sm"
          onClick={() => setChooserOpen(true)}
          disabled={loading}
        >
          <Plus className="size-3.5" /> Request a data warehouse
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

      {!loading && !loadError && (
        <div className="surface-panel overflow-hidden rounded-xl divide-y divide-border/70">
          {showFeatBitRow && <FeatBitManagedRow />}
          {showCustomerRows &&
            providers.map((p) => (
              <CustomerEndpointRow
                key={p.id}
                provider={p}
                onClick={() => setCustomerFormMode({ kind: "edit", provider: p })}
              />
            ))}

          {showCustomerRows && providers.length === 0 && filter === "customer-endpoint" && (
            <CustomerEmptyState onAdd={() => setChooserOpen(true)} />
          )}
        </div>
      )}

      {/* Dialogs */}
      <AddDataSourceChooserDialog
        open={chooserOpen}
        onClose={() => setChooserOpen(false)}
        onPickCustomerEndpoint={() => {
          setChooserOpen(false);
          setCustomerFormMode({ kind: "add" });
        }}
        onPickExternalWarehouse={() => {
          setChooserOpen(false);
          setRequestExtOpen(true);
        }}
      />

      {customerFormMode && (
        <CustomerEndpointFormDialog
          open
          mode={customerFormMode}
          projectKey={projectKey}
          onClose={() => setCustomerFormMode(null)}
          onCreated={handleCreated}
          onUpdated={handleUpdated}
          onRotated={handleRotated}
          onDeleted={handleDeleted}
        />
      )}

      <RequestProviderDialog
        open={requestExtOpen}
        onOpenChange={setRequestExtOpen}
      />

      <SecretRevealDialog
        open={revealedSecret !== null}
        secret={revealedSecret?.secret ?? null}
        context={revealedSecret?.context ?? "created"}
        onClose={() => setRevealedSecret(null)}
      />
    </div>
  );
}

// ── Row components ──────────────────────────────────────────────────────────

function FeatBitManagedRow() {
  return (
    <a
      href="/data/apis-sdks"
      target="_blank"
      rel="noopener noreferrer"
      className="flex items-center gap-3 p-3 hover:bg-muted/40 transition-colors"
    >
      <div className="flex size-8 shrink-0 items-center justify-center rounded-md bg-brand/10 text-brand">
        <Database className="size-4" />
      </div>
      <div className="min-w-0 flex-1 space-y-0.5">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-[15px] font-bold tracking-tight">
            FeatBit Managed Data Warehouse
          </span>
          <Badge className="bg-brand/10 text-brand border-0 text-[10px]">
            <CheckCircle2 className="size-3 mr-1" />
            Connected
          </Badge>
          <Badge variant="outline" className="text-[10px]">FeatBit Managed</Badge>
        </div>
        <p className="text-xs text-muted-foreground">
          ClickHouse hosted by FeatBit. Zero setup — flag evaluations and metric
          events already land here.
        </p>
      </div>
      <ExternalLink className="size-3.5 shrink-0 text-muted-foreground" />
    </a>
  );
}

function CustomerEndpointRow({
  provider,
  onClick,
}: {
  provider: ProviderPublic;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center gap-3 p-3 hover:bg-muted/40 transition-colors text-left"
    >
      <div className="flex size-8 shrink-0 items-center justify-center rounded-md bg-brand/10 text-brand">
        <Cable className="size-4" />
      </div>
      <div className="min-w-0 flex-1 space-y-0.5">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-[15px] font-bold tracking-tight truncate">
            {provider.name}
          </span>
          <Badge variant="outline" className="text-[10px]">Customer Endpoint</Badge>
          {provider.hasSecondarySecret && (
            <Badge className="bg-amber-100 text-amber-900 border-0 text-[10px]">
              Rotation grace
            </Badge>
          )}
        </div>
        <div className="text-xs text-muted-foreground truncate font-mono">
          {provider.baseUrl}
        </div>
        <div className="text-[11px] text-muted-foreground flex items-center gap-2 flex-wrap">
          <span>
            secret <code className="font-mono">{provider.signingSecretMasked}</code>
          </span>
          <span>·</span>
          <span>timeout {provider.timeoutMs}ms</span>
          <span>·</span>
          <span>schema v{provider.schemaVersion}</span>
        </div>
      </div>
      <Pencil className="size-3.5 shrink-0 text-muted-foreground" />
    </button>
  );
}

function CustomerEmptyState({ onAdd }: { onAdd: () => void }) {
  return (
    <div className="p-6 text-center space-y-2">
      <Cable className="size-6 mx-auto text-muted-foreground" />
      <p className="text-sm font-medium">No customer endpoints yet</p>
      <p className="text-xs text-muted-foreground max-w-md mx-auto">
        Connect your first warehouse by registering an HTTPS endpoint that
        returns experiment statistics in the FeatBit v1 schema.
      </p>
      <Button type="button" size="sm" variant="outline" onClick={onAdd} className="mt-2">
        <Plus className="size-3.5" /> Add a customer endpoint
      </Button>
    </div>
  );
}
