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
import { Flag, Pencil, Eye, EyeOff, ExternalLink, Code, GitBranch } from "lucide-react";
import type { Experiment, ExperimentRun } from "@/generated/prisma/client";

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

/* ── Flag detail popup (read-only with edit ability) ── */
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

  return (
    <Dialog open={open} onOpenChange={(v) => { onOpenChange(v); if (!v) setEditing(false); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-sm">
            <Flag className="size-4" />
            Feature Flag Details
          </DialogTitle>
          <DialogDescription className="text-xs">
            FeatBit connection details and targeting link.
          </DialogDescription>
        </DialogHeader>

        {editing ? (
          /* ── Edit mode ── */
          <form
            key={experiment.updatedAt.toISOString()}
            action={async (formData) => {
              await updateFlagConfigAction(formData);
              setEditing(false);
              onOpenChange(false);
            }}
            className="space-y-3"
          >
            <input type="hidden" name="experimentId" value={experiment.id} />

            <div className="space-y-1">
              <Label htmlFor="flagKey" className="text-xs">Flag Key</Label>
              <Input id="flagKey" name="flagKey" defaultValue={experiment.flagKey ?? ""} placeholder="e.g. onboarding-tooltip" className="text-sm font-mono" />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label htmlFor="featbitProjectKey" className="text-xs">FeatBit Project</Label>
                <Input id="featbitProjectKey" name="featbitProjectKey" defaultValue={experiment.featbitProjectKey ?? ""} placeholder="e.g. my-project" className="text-sm font-mono" />
              </div>
              <div className="space-y-1">
                <Label htmlFor="featbitEnvId" className="text-xs">FeatBit Environment ID</Label>
                <Input id="featbitEnvId" name="featbitEnvId" defaultValue={experiment.featbitEnvId ?? ""} placeholder="e.g. env-uuid" className="text-sm font-mono" />
              </div>
            </div>

            <div className="space-y-1">
              <Label htmlFor="flagServerUrl" className="text-xs">Server URL</Label>
              <Input id="flagServerUrl" name="flagServerUrl" defaultValue={experiment.flagServerUrl ?? ""} placeholder="https://app.featbit.co" className="text-sm font-mono" />
            </div>

            <div className="space-y-1">
              <Label htmlFor="envSecret" className="text-xs">Env Secret</Label>
              <SecretInput id="envSecret" name="envSecret" defaultValue={experiment.envSecret ?? ""} placeholder="FeatBit environment secret" />
            </div>

            <div className="space-y-1">
              <Label htmlFor="accessToken" className="text-xs">Access Token</Label>
              <SecretInput id="accessToken" name="accessToken" defaultValue={experiment.accessToken ?? ""} placeholder="FeatBit API access token" />
            </div>

            <DialogFooter className="gap-2">
              <Button type="button" variant="outline" size="sm" onClick={() => setEditing(false)}>Cancel</Button>
              <Button type="submit" size="sm">Save</Button>
            </DialogFooter>
          </form>
        ) : (
          /* ── Read-only mode ── */
          <div className="space-y-3">
            <div className="space-y-2">
              <ReadOnlyRow label="Flag Key" value={experiment.flagKey} mono />
              <ReadOnlyRow label="FeatBit Project" value={experiment.featbitProjectKey} mono />
              <ReadOnlyRow label="Environment ID" value={experiment.featbitEnvId} mono />
              <ReadOnlyRow label="Server URL" value={experiment.flagServerUrl} mono />
              <ReadOnlyRow label="Env Secret" value={mask(experiment.envSecret)} mono />
              <ReadOnlyRow label="Access Token" value={mask(experiment.accessToken)} mono />
            </div>

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

function ReadOnlyRow({ label, value, mono }: { label: string; value: string | null | undefined; mono?: boolean }) {
  return (
    <div className="flex items-baseline gap-2">
      <span className="text-[10px] font-medium text-muted-foreground uppercase w-28 shrink-0">{label}</span>
      <span className={`text-xs ${mono ? "font-mono" : ""} ${value ? "" : "italic text-muted-foreground/50"}`}>
        {value || "Not set"}
      </span>
    </div>
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

  // Parse all flag-level variants from experiment.variants
  // Supports two formats:
  //   1. Pipe-separated: "standard (control)|streamlined (treatment)"
  //   2. JSON array:     [{"key":"standard","description":"..."},...]
  const allVariants: { name: string; annotation?: string }[] = (() => {
    if (!experiment.variants) return [];
    const raw = experiment.variants.trim();
    // Try JSON array first
    if (raw.startsWith("[")) {
      try {
        const parsed = JSON.parse(raw) as { key?: string; name?: string; description?: string }[];
        return parsed.map((v) => ({
          name: v.key ?? v.name ?? "",
          annotation: v.description,
        }));
      } catch { /* fall through */ }
    }
    // Pipe-separated: "standard (control)|streamlined (treatment)"
    return raw.split("|").map((v) => {
      const trimmed = v.trim();
      const match = trimmed.match(/^(.+?)\s*\((.+)\)$/);
      return match
        ? { name: match[1].trim(), annotation: match[2].trim() }
        : { name: trimmed };
    });
  })();

  // Build a set of variants used in any experiment run (control or treatment)
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
      </div>

      <div className="rounded-md border bg-muted/10 px-3 py-3 space-y-3">
        {/* Flag key — prominent and clickable */}
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

        {/* All flag variants — parsed from experiment.variants */}
        {allVariants.length > 0 && (
          <div>
            <span className="text-[10px] font-medium text-muted-foreground uppercase">Flag Variants</span>
            <div className="flex flex-wrap gap-1.5 mt-1">
              {allVariants.map(({ name, annotation }) => {
                const isControl = annotation?.toLowerCase().includes("control");
                const isUsed = usedInRuns.has(name);
                return (
                  <Badge
                    key={name}
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
                    {name}
                    {annotation && (
                      <span className="ml-1 text-[10px] text-muted-foreground font-normal">({annotation})</span>
                    )}
                  </Badge>
                );
              })}
            </div>
          </div>
        )}

        {/* FeatBit info summary */}
        {isConfigured && (experiment.featbitProjectKey || experiment.featbitEnvId) && (
          <div className="flex items-center gap-3 text-xs text-muted-foreground flex-wrap">
            {experiment.featbitProjectKey && (
              <span>Project: <span className="font-mono font-medium text-foreground">{experiment.featbitProjectKey}</span></span>
            )}
            {experiment.featbitEnvId && (
              <span>Env: <span className="font-mono font-medium text-foreground">{experiment.featbitEnvId}</span></span>
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

/* ── Legacy export for backward compatibility ── */
export function FlagConfig({ experiment }: { experiment: Experiment }) {
  return <FlagIntegrationHeader experiment={experiment} experimentRuns={[]} />;
}
