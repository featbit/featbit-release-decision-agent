"use client";

import { useState } from "react";
import { updateFlagConfigAction } from "@/lib/actions";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Flag, Pencil, Eye, EyeOff, ExternalLink, Code, GitBranch, Plus, X } from "lucide-react";
import type { Experiment, ExperimentRun } from "@/generated/prisma";

/* ── Types ── */
type VariantRow = { key: string; description: string };

/* ── Parse stored variants to row array ── */
function parseVariantsToRows(variants: string | null | undefined): VariantRow[] {
  if (!variants) return [];
  const raw = variants.trim();
  if (raw.startsWith("[")) {
    try {
      const parsed = JSON.parse(raw) as { key?: string; name?: string; description?: string }[];
      return parsed.map((v) => ({ key: v.key ?? v.name ?? "", description: v.description ?? "" }));
    } catch { /* fall through */ }
  }
  // Pipe-separated legacy format: "standard (control)|streamlined (treatment)"
  return raw.split("|").map((s) => {
    const match = s.trim().match(/^(.+?)\s*\((.+)\)\s*$/);
    return match
      ? { key: match[1].trim(), description: match[2].trim() }
      : { key: s.trim(), description: "" };
  });
}

/* ── Password input with visibility toggle ── */
function SecretInput({
  id,
  name,
  defaultValue,
  placeholder,
}: {
  id: string;
  name: string;
  defaultValue: string;
  placeholder: string;
}) {
  const [visible, setVisible] = useState(false);
  return (
    <div className="relative">
      <Input
        id={id}
        name={name}
        type={visible ? "text" : "password"}
        defaultValue={defaultValue}
        placeholder={placeholder}
        className="text-sm font-mono pr-9"
      />
      <button
        type="button"
        onClick={() => setVisible((v) => !v)}
        className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
        tabIndex={-1}
      >
        {visible ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
      </button>
    </div>
  );
}

/* ── Mask helper for read-only display ── */
function mask(value: string | null | undefined) {
  if (!value) return null;
  if (value.length <= 6) return "••••••";
  return value.slice(0, 3) + "••••" + value.slice(-3);
}

/* ── Build FeatBit targeting URL ── */
function buildFeatBitUrl(experiment: Experiment) {
  const base = (experiment.flagServerUrl ?? "https://app.featbit.co").replace(/\/+$/, "");
  const flagKey = experiment.flagKey;
  const envId = experiment.featbitEnvId;
  if (!flagKey || !envId) return null;
  return `${base}/en/feature-flags/${encodeURIComponent(flagKey)}/targeting?envId=${encodeURIComponent(envId)}`;
}

/* ── Dynamic variations editor ── */
function VariationsEditor({ initialRows }: { initialRows: VariantRow[] }) {
  const [rows, setRows] = useState<VariantRow[]>(
    initialRows.length > 0 ? initialRows : [{ key: "", description: "" }]
  );

  function update(i: number, field: keyof VariantRow, value: string) {
    setRows((prev) => prev.map((r, idx) => (idx === i ? { ...r, [field]: value } : r)));
  }

  function add() {
    setRows((prev) => [...prev, { key: "", description: "" }]);
  }

  function remove(i: number) {
    setRows((prev) => prev.filter((_, idx) => idx !== i));
  }

  return (
    <div className="space-y-2">
      {/* Hidden input carries the JSON to the server action */}
      <input type="hidden" name="variants" value={JSON.stringify(rows)} />

      <div className="grid grid-cols-[1fr_1.5fr_auto] gap-x-2 gap-y-1.5 items-center">
        <span className="text-[10px] font-medium text-muted-foreground uppercase">Key</span>
        <span className="text-[10px] font-medium text-muted-foreground uppercase">Description</span>
        <span />
        {rows.map((row, i) => (
          <>
            <Input
              key={`k-${i}`}
              value={row.key}
              onChange={(e) => update(i, "key", e.target.value)}
              placeholder="e.g. standard"
              className="text-xs font-mono h-7"
            />
            <Input
              key={`d-${i}`}
              value={row.description}
              onChange={(e) => update(i, "description", e.target.value)}
              placeholder="e.g. control"
              className="text-xs h-7"
            />
            <button
              key={`r-${i}`}
              type="button"
              onClick={() => remove(i)}
              className="text-muted-foreground/50 hover:text-destructive transition-colors"
              title="Remove"
            >
              <X className="size-3.5" />
            </button>
          </>
        ))}
      </div>

      <button
        type="button"
        onClick={add}
        className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
      >
        <Plus className="size-3" />
        Add variation
      </button>
    </div>
  );
}

/* ── Edit form (mounts fresh each time editing=true) ── */
function FlagEditForm({
  experiment,
  onDone,
  onCancel,
}: {
  experiment: Experiment;
  onDone: () => void;
  onCancel: () => void;
}) {
  const initialRows = parseVariantsToRows(experiment.variants);

  return (
    <form
      action={async (formData) => {
        await updateFlagConfigAction(formData);
        onDone();
      }}
      className="space-y-3"
    >
      <input type="hidden" name="experimentId" value={experiment.id} />

      <div className="space-y-1">
        <Label htmlFor="flagKey" className="text-xs">Flag Key</Label>
        <Input
          id="flagKey"
          name="flagKey"
          defaultValue={experiment.flagKey ?? ""}
          placeholder="e.g. checkout-flow-ab"
          className="text-sm font-mono"
        />
      </div>

      <fieldset className="space-y-1.5 rounded-lg border px-3 pb-3 pt-2">
        <legend className="px-1 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
          Variations
        </legend>
        <VariationsEditor initialRows={initialRows} />
      </fieldset>

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1">
          <Label htmlFor="featbitProjectKey" className="text-xs">FeatBit Project</Label>
          <Input
            id="featbitProjectKey"
            name="featbitProjectKey"
            defaultValue={experiment.featbitProjectKey ?? ""}
            placeholder="e.g. my-project"
            className="text-sm font-mono"
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="featbitEnvId" className="text-xs">Environment ID</Label>
          <Input
            id="featbitEnvId"
            name="featbitEnvId"
            defaultValue={experiment.featbitEnvId ?? ""}
            placeholder="e.g. env-uuid"
            className="text-sm font-mono"
          />
        </div>
      </div>

      <div className="space-y-1">
        <Label htmlFor="flagServerUrl" className="text-xs">Server URL</Label>
        <Input
          id="flagServerUrl"
          name="flagServerUrl"
          defaultValue={experiment.flagServerUrl ?? ""}
          placeholder="https://app.featbit.co"
          className="text-sm font-mono"
        />
      </div>

      <div className="space-y-1">
        <Label htmlFor="envSecret" className="text-xs">Env Secret</Label>
        <SecretInput
          id="envSecret"
          name="envSecret"
          defaultValue={experiment.envSecret ?? ""}
          placeholder="FeatBit environment secret"
        />
      </div>

      <div className="space-y-1">
        <Label htmlFor="accessToken" className="text-xs">Access Token</Label>
        <SecretInput
          id="accessToken"
          name="accessToken"
          defaultValue={experiment.accessToken ?? ""}
          placeholder="FeatBit API access token"
        />
      </div>

      <DialogFooter className="gap-2">
        <Button type="button" variant="outline" size="sm" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" size="sm">Save</Button>
      </DialogFooter>
    </form>
  );
}

/* ── Read-only row ── */
function ReadOnlyRow({
  label,
  value,
  mono,
}: {
  label: string;
  value: string | null | undefined;
  mono?: boolean;
}) {
  return (
    <div className="flex items-baseline gap-2">
      <span className="text-[10px] font-medium text-muted-foreground uppercase w-28 shrink-0">
        {label}
      </span>
      <span className={`text-xs ${mono ? "font-mono" : ""} ${value ? "" : "italic text-muted-foreground/50"}`}>
        {value || "Not set"}
      </span>
    </div>
  );
}

/* ── Flag detail popup ── */
function FlagDetailPopup({
  experiment,
  open,
  onOpenChange,
}: {
  experiment: Experiment;
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const [editing, setEditing] = useState(false);
  const featbitUrl = buildFeatBitUrl(experiment);
  const variantRows = parseVariantsToRows(experiment.variants);

  function close() {
    setEditing(false);
    onOpenChange(false);
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!v) { setEditing(false); onOpenChange(false); }
      }}
    >
      <DialogContent className="sm:max-w-md max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-sm">
            <Flag className="size-4" />
            Feature Flag Details
          </DialogTitle>
          <DialogDescription className="text-xs">
            FeatBit connection details, variations, and targeting link.
          </DialogDescription>
        </DialogHeader>

        {editing ? (
          <FlagEditForm experiment={experiment} onDone={close} onCancel={() => setEditing(false)} />
        ) : (
          <div className="space-y-3">
            <div className="space-y-2">
              <ReadOnlyRow label="Flag Key" value={experiment.flagKey} mono />
              <ReadOnlyRow label="FeatBit Project" value={experiment.featbitProjectKey} mono />
              <ReadOnlyRow label="Environment ID" value={experiment.featbitEnvId} mono />
              <ReadOnlyRow label="Server URL" value={experiment.flagServerUrl} mono />
              <ReadOnlyRow label="Env Secret" value={mask(experiment.envSecret)} mono />
              <ReadOnlyRow label="Access Token" value={mask(experiment.accessToken)} mono />
            </div>

            {/* Variations read-only */}
            {variantRows.length > 0 && (
              <div className="space-y-1">
                <span className="text-[10px] font-medium text-muted-foreground uppercase">
                  Variations
                </span>
                <div className="space-y-1">
                  {variantRows.map((v, i) => (
                    <div key={i} className="flex items-baseline gap-2">
                      <span className="text-xs font-mono font-medium">{v.key}</span>
                      {v.description && (
                        <span className="text-[11px] text-muted-foreground">{v.description}</span>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {featbitUrl && (
              <a
                href={featbitUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1.5 text-xs text-blue-600 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300"
              >
                <ExternalLink className="size-3" />
                Open in FeatBit Targeting
              </a>
            )}

            <DialogFooter>
              <Button variant="outline" size="sm" onClick={() => setEditing(true)}>
                <Pencil className="size-3 mr-1.5" />
                Edit
              </Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

/* ── Main flag + variants section ── */
export function FlagIntegrationHeader({
  experiment,
  experimentRuns,
}: {
  experiment: Experiment;
  experimentRuns: ExperimentRun[];
}) {
  const [popupOpen, setPopupOpen] = useState(false);
  const isConfigured = Boolean(experiment.flagKey);
  const featbitUrl = buildFeatBitUrl(experiment);

  const allVariants = parseVariantsToRows(experiment.variants);

  // Variants used in any run (for colour-coding)
  const usedInRuns = new Set<string>();
  for (const run of experimentRuns) {
    if (run.controlVariant) run.controlVariant.split("|").forEach((v) => usedInRuns.add(v.trim()));
    if (run.treatmentVariant) run.treatmentVariant.split("|").forEach((v) => usedInRuns.add(v.trim()));
  }

  return (
    <section className="space-y-3">
      <div className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
        <Code className="size-3.5" />
        <span>Feature Flag Integration</span>
        <button
          type="button"
          onClick={() => setPopupOpen(true)}
          className="ml-1 text-muted-foreground/50 hover:text-foreground transition-colors"
          title="Edit feature flag"
        >
          <Pencil className="size-3" />
        </button>
      </div>

      <div className="rounded-md border bg-muted/10 px-3 py-3 space-y-3">
        {/* Flag key */}
        <div className="flex items-center gap-3 flex-wrap">
          <span className="text-[10px] font-medium text-muted-foreground uppercase">Flag Key</span>
          {isConfigured ? (
            <button
              type="button"
              onClick={() => setPopupOpen(true)}
              className="group flex items-center gap-1.5 cursor-pointer"
            >
              <Badge className="text-sm font-mono px-2.5 py-0.5 bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300 group-hover:bg-blue-200 dark:group-hover:bg-blue-900/60 transition-colors">
                <Flag className="size-3 mr-1" />
                {experiment.flagKey}
              </Badge>
              {featbitUrl && (
                <ExternalLink className="size-3 text-muted-foreground group-hover:text-blue-600 transition-colors" />
              )}
            </button>
          ) : (
            <button
              type="button"
              onClick={() => setPopupOpen(true)}
              className="flex items-center gap-1.5 text-xs text-muted-foreground/50 italic hover:text-muted-foreground cursor-pointer"
            >
              Not configured — click to set up
              <Pencil className="size-3" />
            </button>
          )}
        </div>

        {/* Variations */}
        {allVariants.length > 0 && (
          <div>
            <span className="text-[10px] font-medium text-muted-foreground uppercase">Variations</span>
            <div className="flex flex-wrap gap-1.5 mt-1">
              {allVariants.map(({ key, description }) => {
                const isControl = description?.toLowerCase().includes("control");
                const isUsed = usedInRuns.has(key);
                return (
                  <Badge
                    key={key}
                    variant="outline"
                    className={`font-mono text-xs px-2 py-0.5 ${
                      isControl
                        ? "border-emerald-300 text-emerald-700 dark:border-emerald-700 dark:text-emerald-300"
                        : isUsed
                        ? "border-violet-300 text-violet-700 dark:border-violet-700 dark:text-violet-300"
                        : "border-muted-foreground/30 text-muted-foreground"
                    }`}
                  >
                    <GitBranch className="size-3 mr-1" />
                    {key}
                    {description && (
                      <span className="ml-1 text-[10px] text-muted-foreground font-normal">
                        ({description})
                      </span>
                    )}
                  </Badge>
                );
              })}
            </div>
          </div>
        )}

        {/* FeatBit connection info */}
        {isConfigured && (experiment.featbitProjectKey || experiment.featbitEnvId) && (
          <div className="flex items-center gap-3 text-xs text-muted-foreground flex-wrap">
            {experiment.featbitProjectKey && (
              <span>
                Project:{" "}
                <span className="font-mono font-medium text-foreground">
                  {experiment.featbitProjectKey}
                </span>
              </span>
            )}
            {experiment.featbitEnvId && (
              <span>
                Env:{" "}
                <span className="font-mono font-medium text-foreground">
                  {experiment.featbitEnvId}
                </span>
              </span>
            )}
            {experiment.envSecret && (
              <Badge variant="secondary" className="text-[10px]">Connected</Badge>
            )}
          </div>
        )}
      </div>

      <FlagDetailPopup experiment={experiment} open={popupOpen} onOpenChange={setPopupOpen} />
    </section>
  );
}

/* ── Legacy export ── */
export function FlagConfig({ experiment }: { experiment: Experiment }) {
  return <FlagIntegrationHeader experiment={experiment} experimentRuns={[]} />;
}
