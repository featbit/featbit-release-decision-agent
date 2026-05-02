"use client";

import { useEffect, useState } from "react";
import { Database, Cable, ClipboardPaste, ExternalLink, Loader2, AlertCircle, CheckCircle2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import type { ProviderPublic } from "@/components/data-warehouse/types";

/**
 * Project-level data source step in the Expert experiment setup wizard.
 *
 * Picks one of:
 *   - featbit-managed (default): existing track-service flow
 *   - customer-single:           Customer Managed Data Endpoint, single provider serves all metrics
 *   - manual:                    operator pastes per-variant totals in later steps
 *   - external-text:             free-text note, no live data fetch
 *
 * `customer-per-metric` (Mode B in the spec) is intentionally not surfaced
 * here yet — ship single-endpoint first, add per-metric routing once real
 * users ask for it.
 */

export type DataSourceMode =
  | "featbit-managed"
  | "customer-single"
  | "manual"
  | "external-text";

export interface CustomerEndpointConfigA {
  providerId:    string;
  path:          string;
  staticParams?: Record<string, unknown>;
}

const MODE_OPTIONS: {
  key: DataSourceMode;
  label: string;
  desc: string;
  icon: React.ComponentType<{ className?: string }>;
}[] = [
  {
    key: "featbit-managed",
    label: "FeatBit Managed",
    desc: "Auto-pull from FeatBit's track-service using flag + event names.",
    icon: Database,
  },
  {
    key: "customer-single",
    label: "Customer Managed Endpoint",
    desc: "Call your own HTTPS endpoint that returns experiment statistics on demand.",
    icon: Cable,
  },
  {
    key: "manual",
    label: "Paste manually",
    desc: "Enter per-variant totals in the Primary metric / Guardrails steps.",
    icon: ClipboardPaste,
  },
  {
    key: "external-text",
    label: "External / other",
    desc: "Describe where data will come from. No live fetch — record only.",
    icon: ExternalLink,
  },
];

export function DataSourceStepContent({
  projectKey,
  initialMode,
  initialCustomerConfig,
  initialExternalNote,
}: {
  projectKey: string | null;
  initialMode: DataSourceMode;
  initialCustomerConfig: CustomerEndpointConfigA | null;
  initialExternalNote: string;
}) {
  const [mode, setMode] = useState<DataSourceMode>(initialMode);

  // Customer-mode state (only relevant when mode === "customer-single")
  const [providerId, setProviderId] = useState<string>(initialCustomerConfig?.providerId ?? "");
  const [path, setPath]       = useState<string>(initialCustomerConfig?.path ?? "");
  const [staticParams, setStaticParams] = useState<string>(
    initialCustomerConfig?.staticParams ? JSON.stringify(initialCustomerConfig.staticParams, null, 2) : "",
  );
  const [staticParamsError, setStaticParamsError] = useState<string | null>(null);

  const [externalNote, setExternalNote] = useState<string>(initialExternalNote);

  const [providers, setProviders]       = useState<ProviderPublic[]>([]);
  const [providersLoading, setLoading]  = useState(false);
  const [providersError, setProvErr]    = useState<string | null>(null);

  const [testBusy, setTestBusy] = useState(false);
  const [testResult, setTestResult] = useState<
    | { ok: true; attempts: number }
    | { ok: false; message: string; kind: string; status?: number; attempts: number }
    | null
  >(null);

  // Fetch providers when entering customer mode (and projectKey is available)
  useEffect(() => {
    if (mode !== "customer-single" || !projectKey) return;
    let cancelled = false;
    setLoading(true);
    setProvErr(null);
    fetch(`/api/projects/${encodeURIComponent(projectKey)}/customer-endpoints`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((json: ProviderPublic[]) => { if (!cancelled) setProviders(json); })
      .catch((e: Error) => { if (!cancelled) setProvErr(e.message); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [mode, projectKey]);

  // Build the customerEndpointConfig JSON sent to the server action.
  let customerEndpointConfigJson = "";
  if (mode === "customer-single" && providerId && path) {
    let parsedStatic: Record<string, unknown> | undefined;
    if (staticParams.trim()) {
      try {
        parsedStatic = JSON.parse(staticParams);
        if (parsedStatic === null || typeof parsedStatic !== "object" || Array.isArray(parsedStatic)) {
          parsedStatic = undefined;
        }
      } catch {/* surfaced via staticParamsError below */}
    }
    customerEndpointConfigJson = JSON.stringify({
      providerId,
      path,
      ...(parsedStatic && { staticParams: parsedStatic }),
    });
  }

  // Validate static params live so the user gets immediate feedback
  useEffect(() => {
    if (mode !== "customer-single" || !staticParams.trim()) {
      setStaticParamsError(null);
      return;
    }
    try {
      const v = JSON.parse(staticParams);
      if (v === null || typeof v !== "object" || Array.isArray(v)) {
        setStaticParamsError("Static params must be a JSON object (e.g. {\"tenantId\":\"acme\"})");
      } else {
        setStaticParamsError(null);
      }
    } catch (e) {
      setStaticParamsError(`Invalid JSON: ${(e as Error).message}`);
    }
  }, [mode, staticParams]);

  async function runTest() {
    if (mode !== "customer-single" || !projectKey || !providerId) return;
    setTestBusy(true);
    setTestResult(null);
    try {
      const res = await fetch(
        `/api/projects/${encodeURIComponent(projectKey)}/customer-endpoints/${encodeURIComponent(providerId)}/test`,
        { method: "POST" },
      );
      const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      if (json.ok === true) {
        setTestResult({ ok: true, attempts: Number(json.attempts ?? 1) });
      } else {
        setTestResult({
          ok: false,
          kind: String(json.kind ?? "unknown"),
          status: typeof json.status === "number" ? json.status : undefined,
          message: String(json.message ?? "Unknown error"),
          attempts: Number(json.attempts ?? 1),
        });
      }
    } catch (e) {
      setTestResult({
        ok: false, kind: "client-fetch",
        message: e instanceof Error ? e.message : String(e),
        attempts: 1,
      });
    } finally {
      setTestBusy(false);
    }
  }

  return (
    <div className="space-y-3">
      {/* Hidden form fields submitted to saveExpertSetupAction */}
      <input type="hidden" name="dataSourceMode" value={mode} />
      <input type="hidden" name="customerEndpointConfig" value={customerEndpointConfigJson} />
      <input type="hidden" name="externalNote" value={externalNote} />

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        {MODE_OPTIONS.map((opt) => {
          const Icon = opt.icon;
          const active = mode === opt.key;
          return (
            <button
              type="button"
              key={opt.key}
              onClick={() => setMode(opt.key)}
              className={cn(
                "rounded-md border px-3 py-2.5 text-left transition-colors",
                active
                  ? "border-foreground bg-foreground/5"
                  : "border-border hover:bg-muted/40",
              )}
            >
              <div className="flex items-start gap-2">
                <Icon className={cn("size-4 mt-0.5 shrink-0", active ? "text-foreground" : "text-muted-foreground")} />
                <div className="min-w-0 flex-1">
                  <div className="text-xs font-semibold">{opt.label}</div>
                  <div className="text-[10px] text-muted-foreground mt-0.5 leading-snug">
                    {opt.desc}
                  </div>
                </div>
              </div>
            </button>
          );
        })}
      </div>

      {mode === "customer-single" && (
        <div className="rounded-md border bg-muted/20 p-3 space-y-3">
          {!projectKey && (
            <div className="text-xs text-destructive flex items-center gap-2">
              <AlertCircle className="size-3.5" /> Project context unavailable.
            </div>
          )}

          {projectKey && (
            <>
              <div className="space-y-1">
                <Label htmlFor="ds-provider" className="text-xs">Provider</Label>
                {providersLoading && (
                  <div className="text-xs text-muted-foreground flex items-center gap-2">
                    <Loader2 className="size-3.5 animate-spin" /> Loading providers…
                  </div>
                )}
                {providersError && (
                  <div className="text-xs text-destructive flex items-center gap-2">
                    <AlertCircle className="size-3.5" /> {providersError}
                  </div>
                )}
                {!providersLoading && !providersError && providers.length === 0 && (
                  <div className="text-xs text-muted-foreground">
                    No providers configured. Add one in <a href="/data-warehouse" className="underline" target="_blank" rel="noopener noreferrer">Data Warehouse</a>.
                  </div>
                )}
                {providers.length > 0 && (
                  <select
                    id="ds-provider"
                    value={providerId}
                    onChange={(e) => setProviderId(e.target.value)}
                    className={cn(
                      "h-8 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none",
                      "focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50",
                    )}
                  >
                    <option value="">— select a provider —</option>
                    {providers.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name} — {p.baseUrl}
                      </option>
                    ))}
                  </select>
                )}
              </div>

              <div className="space-y-1">
                <Label htmlFor="ds-path" className="text-xs">Endpoint path</Label>
                <Input
                  id="ds-path"
                  value={path}
                  onChange={(e) => setPath(e.target.value)}
                  placeholder="/experiments/headline-test/stats"
                  className="text-sm font-mono"
                />
                <p className="text-[10px] text-muted-foreground">
                  Appended to the provider&apos;s base URL. FeatBit POSTs the v1 request body to this URL.
                </p>
              </div>

              <div className="space-y-1">
                <Label htmlFor="ds-static" className="text-xs">Static params (optional JSON object)</Label>
                <Textarea
                  id="ds-static"
                  value={staticParams}
                  onChange={(e) => setStaticParams(e.target.value)}
                  rows={2}
                  placeholder='{"tenantId": "acme-eu"}'
                  className={cn("text-xs font-mono resize-none", staticParamsError && "border-destructive")}
                />
                {staticParamsError && (
                  <p className="text-[10px] text-destructive">{staticParamsError}</p>
                )}
                <p className="text-[10px] text-muted-foreground">
                  Merged into the request body verbatim. Useful for tenant IDs, region pins, etc.
                </p>
              </div>

              {providerId && (
                <div className="border-t border-border/60 pt-2 space-y-1.5">
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={runTest}
                    disabled={testBusy}
                  >
                    {testBusy ? <Loader2 className="size-3.5 animate-spin" /> : <CheckCircle2 className="size-3.5" />}
                    Test connection (provider ping)
                  </Button>
                  {testResult?.ok === true && (
                    <div className="text-xs text-emerald-700 flex items-start gap-1.5">
                      <CheckCircle2 className="size-3.5 mt-0.5 shrink-0" />
                      OK after {testResult.attempts} attempt{testResult.attempts === 1 ? "" : "s"}.
                    </div>
                  )}
                  {testResult?.ok === false && (
                    <div className="text-xs text-destructive flex items-start gap-1.5">
                      <AlertCircle className="size-3.5 mt-0.5 shrink-0" />
                      <span className="break-all">
                        <strong className="capitalize">{testResult.kind}</strong>
                        {testResult.status ? ` (${testResult.status})` : ""}: {testResult.message}
                      </span>
                    </div>
                  )}
                  <p className="text-[10px] text-muted-foreground">
                    Pings the provider&apos;s base URL with <code>experimentId=&quot;featbit-ping&quot;</code> — verifies HMAC + transport without a real experiment lookup. Endpoint path above isn&apos;t exercised by Test.
                  </p>
                </div>
              )}
            </>
          )}
        </div>
      )}

      {mode === "manual" && (
        <p className="text-xs text-muted-foreground rounded-md border border-dashed bg-muted/20 px-3 py-2">
          Per-variant totals are entered alongside each metric in later steps. The analyser
          uses whatever you paste — no live fetch.
        </p>
      )}

      {mode === "external-text" && (
        <div className="space-y-1">
          <Label htmlFor="ds-external-note" className="text-xs">Where will the data come from?</Label>
          <Textarea
            id="ds-external-note"
            value={externalNote}
            onChange={(e) => setExternalNote(e.target.value)}
            rows={2}
            placeholder="e.g. Snowflake query owned by data team, weekly export"
            className="text-xs resize-none"
          />
          <p className="text-[10px] text-muted-foreground">
            Recorded for context. The analyser won&apos;t live-fetch in this mode.
          </p>
        </div>
      )}
    </div>
  );
}
