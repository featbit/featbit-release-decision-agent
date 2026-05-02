"use client";

import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogClose,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2, RotateCw, Trash2, PlugZap, CheckCircle2, AlertCircle } from "lucide-react";
import type { ProviderPublic, ProviderWithSecret } from "./types";

type Mode =
  | { kind: "add" }
  | { kind: "edit"; provider: ProviderPublic };

/**
 * Add OR edit a Customer Managed Data Endpoint provider.
 *
 * - Add: collects name + baseUrl + (optional) timeoutMs. On success the
 *   parent surfaces the returned plaintext secret via SecretRevealDialog.
 * - Edit: same fields, plus secondary actions: rotate-secret,
 *   clear-secondary (when applicable), and delete-with-confirm.
 *
 * The signing secret is never editable here — it's auto-generated server-side.
 */
export function CustomerEndpointFormDialog({
  open,
  mode,
  projectKey,
  onClose,
  onCreated,
  onUpdated,
  onRotated,
  onDeleted,
}: {
  open: boolean;
  mode: Mode;
  projectKey: string;
  onClose: () => void;
  onCreated: (created: ProviderWithSecret) => void;
  onUpdated: (updated: ProviderPublic) => void;
  onRotated: (rotated: ProviderWithSecret) => void;
  onDeleted: (id: string) => void;
}) {
  const [name, setName] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [timeoutMs, setTimeoutMs] = useState<number | "">("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [testResult, setTestResult] = useState<
    | { ok: true; attempts: number }
    | { ok: false; message: string; kind: string; status?: number; attempts: number }
    | null
  >(null);

  // Reset form when (re)opening, or load values when switching to edit mode.
  useEffect(() => {
    if (!open) return;
    setError(null);
    setConfirmDelete(false);
    setTestResult(null);
    if (mode.kind === "add") {
      setName("");
      setBaseUrl("");
      setTimeoutMs("");
    } else {
      setName(mode.provider.name);
      setBaseUrl(mode.provider.baseUrl);
      setTimeoutMs(mode.provider.timeoutMs);
    }
  }, [open, mode]);

  const apiPath =
    mode.kind === "add"
      ? `/api/projects/${encodeURIComponent(projectKey)}/customer-endpoints`
      : `/api/projects/${encodeURIComponent(projectKey)}/customer-endpoints/${encodeURIComponent(mode.provider.id)}`;

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const payload: Record<string, unknown> = {
        name: name.trim(),
        baseUrl: baseUrl.trim(),
      };
      if (timeoutMs !== "") payload.timeoutMs = timeoutMs;
      if (mode.kind === "edit") payload.action = "update";

      const res = await fetch(apiPath, {
        method: mode.kind === "add" ? "POST" : "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      if (!res.ok) {
        throw new Error(typeof json.error === "string" ? json.error : `HTTP ${res.status}`);
      }

      if (mode.kind === "add") {
        onCreated(json as unknown as ProviderWithSecret);
      } else {
        onUpdated(json as unknown as ProviderPublic);
      }
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function handleRotate() {
    if (mode.kind !== "edit") return;
    setError(null);
    setBusy(true);
    try {
      const res = await fetch(apiPath, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "rotate-secret" }),
      });
      const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      if (!res.ok) {
        throw new Error(typeof json.error === "string" ? json.error : `HTTP ${res.status}`);
      }
      onRotated(json as unknown as ProviderWithSecret);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function handleClearSecondary() {
    if (mode.kind !== "edit") return;
    setError(null);
    setBusy(true);
    try {
      const res = await fetch(apiPath, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "clear-secondary" }),
      });
      const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      if (!res.ok) {
        throw new Error(typeof json.error === "string" ? json.error : `HTTP ${res.status}`);
      }
      onUpdated(json as unknown as ProviderPublic);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function handleTest() {
    if (mode.kind !== "edit") return;
    setError(null);
    setTestResult(null);
    setBusy(true);
    try {
      const res = await fetch(`${apiPath}/test`, { method: "POST" });
      const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      if (!res.ok) {
        throw new Error(typeof json.error === "string" ? json.error : `HTTP ${res.status}`);
      }
      if (json.ok === true) {
        setTestResult({ ok: true, attempts: Number(json.attempts ?? 1) });
      } else {
        setTestResult({
          ok:       false,
          kind:     String(json.kind ?? "unknown"),
          status:   typeof json.status === "number" ? json.status : undefined,
          message:  String(json.message ?? "Unknown error"),
          attempts: Number(json.attempts ?? 1),
        });
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete() {
    if (mode.kind !== "edit") return;
    setError(null);
    setBusy(true);
    try {
      const res = await fetch(apiPath, { method: "DELETE" });
      if (!res.ok && res.status !== 204) {
        const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
        throw new Error(typeof json.error === "string" ? json.error : `HTTP ${res.status}`);
      }
      onDeleted(mode.provider.id);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !next && !busy && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {mode.kind === "add"
              ? "Add Customer Managed Data Endpoint"
              : `Edit "${mode.provider.name}"`}
          </DialogTitle>
          <DialogDescription>
            {mode.kind === "add"
              ? "Register a project-level provider. Each experiment can then point a per-experiment endpoint at this provider."
              : "Update transport settings or rotate the signing secret. The plaintext secret is shown only once after rotation."}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSave} className="space-y-3 pt-1">
          <div className="space-y-1.5">
            <Label htmlFor="provider-name">Display name</Label>
            <Input
              id="provider-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. acme-snowflake"
              required
              maxLength={64}
              disabled={busy}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="provider-base-url">Base URL (HTTPS)</Label>
            <Input
              id="provider-base-url"
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
              placeholder="https://stats.example.com/featbit"
              required
              disabled={busy}
            />
            <p className="text-xs text-muted-foreground">
              Per-experiment endpoint paths are appended to this base.
            </p>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="provider-timeout">Timeout (ms)</Label>
            <Input
              id="provider-timeout"
              type="number"
              min={1000}
              max={60000}
              value={timeoutMs}
              onChange={(e) =>
                setTimeoutMs(e.target.value === "" ? "" : Number(e.target.value))
              }
              placeholder="15000"
              disabled={busy}
            />
          </div>

          {mode.kind === "edit" && (
            <div className="rounded-md border p-3 space-y-2 bg-muted/20">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                  Connection
                </span>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={handleTest}
                  disabled={busy}
                >
                  {busy ? <Loader2 className="size-3.5 animate-spin" /> : <PlugZap className="size-3.5" />}
                  Test
                </Button>
              </div>
              {testResult?.ok === true && (
                <div className="flex items-start gap-2 text-xs text-emerald-700">
                  <CheckCircle2 className="size-3.5 mt-0.5 shrink-0" />
                  <span>
                    OK — endpoint responded with a valid v1 schema after {testResult.attempts} attempt{testResult.attempts === 1 ? "" : "s"}.
                  </span>
                </div>
              )}
              {testResult?.ok === false && (
                <div className="flex items-start gap-2 text-xs text-destructive">
                  <AlertCircle className="size-3.5 mt-0.5 shrink-0" />
                  <span className="break-all">
                    <strong className="capitalize">{testResult.kind}</strong>
                    {testResult.status ? ` (${testResult.status})` : ""}: {testResult.message}
                    {testResult.attempts > 1 && ` (after ${testResult.attempts} attempts)`}
                  </span>
                </div>
              )}
              <div className="border-t border-border/60 pt-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
                Signing secret
              </div>
              <div className="flex items-center justify-between gap-2">
                <code className="font-mono text-xs">{mode.provider.signingSecretMasked}</code>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={handleRotate}
                  disabled={busy}
                >
                  <RotateCw className="size-3.5" /> Rotate
                </Button>
              </div>
              {mode.provider.hasSecondarySecret && (
                <div className="flex items-center justify-between gap-2 pt-1 border-t border-border/60">
                  <span className="text-xs text-muted-foreground">
                    Secondary secret active (rotation grace).
                  </span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={handleClearSecondary}
                    disabled={busy}
                  >
                    Clear secondary
                  </Button>
                </div>
              )}
            </div>
          )}

          {error && (
            <div className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-xs text-destructive">
              {error}
            </div>
          )}

          <DialogFooter className="gap-2 pt-2">
            {mode.kind === "edit" && !confirmDelete && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setConfirmDelete(true)}
                disabled={busy}
                className="mr-auto text-destructive hover:text-destructive"
              >
                <Trash2 className="size-3.5" /> Delete
              </Button>
            )}
            {mode.kind === "edit" && confirmDelete && (
              <Button
                type="button"
                variant="destructive"
                size="sm"
                onClick={handleDelete}
                disabled={busy}
                className="mr-auto"
              >
                {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Trash2 className="size-3.5" />}
                Confirm delete
              </Button>
            )}
            <DialogClose render={<Button type="button" variant="outline" disabled={busy}>Cancel</Button>} />
            <Button type="submit" disabled={busy}>
              {busy && <Loader2 className="size-3.5 animate-spin" />}
              {mode.kind === "add" ? "Add provider" : "Save changes"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
