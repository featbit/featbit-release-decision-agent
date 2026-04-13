"use client";

import { useState } from "react";
import { updateMetricsAction } from "@/lib/actions";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Pencil, Plus, X } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Experiment } from "@/generated/prisma";

/* ── Types ── */
type GuardrailRow = { name: string; description: string };

/* ── Parse primaryMetric from JSON or plain text ── */
function parsePrimaryMetric(value: string | null | undefined) {
  if (!value) {
    return { name: "", event: "", metricType: "binary", metricAgg: "once", description: "" };
  }
  try {
    const p = JSON.parse(value);
    if (p && typeof p === "object") {
      return {
        name: p.name ?? "",
        event: p.event ?? "",
        metricType: p.metricType ?? "binary",
        metricAgg: p.metricAgg ?? "once",
        description: p.description ?? "",
      };
    }
  } catch { /* plain text */ }
  return { name: value, event: "", metricType: "binary", metricAgg: "once", description: "" };
}

/* ── Parse guardrails from JSON array or free text ── */
function parseGuardrailsToRows(value: string | null | undefined): GuardrailRow[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    if (Array.isArray(parsed)) {
      return parsed.map((g) => ({
        name: g.name ?? g.event ?? "",
        description: g.description ?? "",
      }));
    }
  } catch { /* free text */ }
  // Legacy free-text: "event_name — description" (one per line)
  return value
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const match = line.match(/^(.+?)\s*[—–-]+\s*(.+)$/);
      return match
        ? { name: match[1].trim(), description: match[2].trim() }
        : { name: line, description: "" };
    });
}

/* ── Styled native select ── */
function NativeSelect({
  id,
  name,
  defaultValue,
  children,
}: {
  id: string;
  name: string;
  defaultValue: string;
  children: React.ReactNode;
}) {
  return (
    <select
      id={id}
      name={name}
      defaultValue={defaultValue}
      className={cn(
        "h-8 w-full rounded-lg border border-input bg-transparent px-2.5 py-1 text-sm",
        "transition-colors outline-none",
        "focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
      )}
    >
      {children}
    </select>
  );
}

/* ── Dynamic guardrails editor ── */
function GuardrailsEditor({ initialRows }: { initialRows: GuardrailRow[] }) {
  const [rows, setRows] = useState<GuardrailRow[]>(initialRows);

  function update(i: number, field: keyof GuardrailRow, value: string) {
    setRows((prev) => prev.map((r, idx) => (idx === i ? { ...r, [field]: value } : r)));
  }

  function add() {
    setRows((prev) => [...prev, { name: "", description: "" }]);
  }

  function remove(i: number) {
    setRows((prev) => prev.filter((_, idx) => idx !== i));
  }

  return (
    <div className="space-y-2">
      {/* Hidden input carries the JSON to the server action */}
      <input type="hidden" name="guardrails" value={JSON.stringify(rows)} />

      {rows.length > 0 && (
        <div className="space-y-2">
          {rows.map((row, i) => (
            <div key={i} className="rounded-md border px-2.5 py-2 space-y-1.5 relative">
              <button
                type="button"
                onClick={() => remove(i)}
                className="absolute top-2 right-2 text-muted-foreground/40 hover:text-destructive transition-colors"
                title="Remove"
              >
                <X className="size-3" />
              </button>

              <div className="space-y-1 pr-5">
                <Label className="text-[10px] uppercase text-muted-foreground">Metric Name</Label>
                <Input
                  value={row.name}
                  onChange={(e) => update(i, "name", e.target.value)}
                  placeholder="e.g. checkout_abandoned"
                  className="text-xs font-mono h-7"
                />
              </div>

              <div className="space-y-1">
                <Label className="text-[10px] uppercase text-muted-foreground">Description</Label>
                <Textarea
                  value={row.description}
                  onChange={(e) => update(i, "description", e.target.value)}
                  placeholder="e.g. Must not increase — streamlined flow must not confuse users"
                  rows={2}
                  className="text-xs resize-none"
                />
              </div>
            </div>
          ))}
        </div>
      )}

      <button
        type="button"
        onClick={add}
        className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
      >
        <Plus className="size-3" />
        Add guardrail
      </button>
    </div>
  );
}

/* ── Metric edit form (mounts fresh each time dialog opens) ── */
function MetricEditForm({
  experiment,
  onDone,
  onCancel,
}: {
  experiment: Experiment;
  onDone: () => void;
  onCancel: () => void;
}) {
  const metric = parsePrimaryMetric(experiment.primaryMetric);
  const guardrailRows = parseGuardrailsToRows(experiment.guardrails);

  return (
    <form
      action={async (formData) => {
        await updateMetricsAction(formData);
        onDone();
      }}
      className="space-y-4 pt-1"
    >
      <input type="hidden" name="experimentId" value={experiment.id} />

      {/* ── Primary Metric ── */}
      <fieldset className="space-y-3 rounded-lg border px-3 pb-3 pt-2">
        <legend className="px-1 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
          Primary Metric
        </legend>

        <div className="space-y-1">
          <Label htmlFor="metricName" className="text-xs">Metric Name</Label>
          <Input
            id="metricName"
            name="metricName"
            defaultValue={metric.name}
            placeholder="e.g. Checkout completion rate"
            className="text-sm"
          />
        </div>

        <div className="space-y-1">
          <Label htmlFor="metricEvent" className="text-xs">Event Name</Label>
          <Input
            id="metricEvent"
            name="metricEvent"
            defaultValue={metric.event}
            placeholder="e.g. purchase_completed"
            className="text-sm font-mono"
          />
          <p className="text-[10px] text-muted-foreground">
            The event key tracked in your application
          </p>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <Label htmlFor="metricType" className="text-xs">Metric Type</Label>
            <NativeSelect id="metricType" name="metricType" defaultValue={metric.metricType}>
              <option value="binary">Binary (conversion)</option>
              <option value="numeric">Numeric (value)</option>
            </NativeSelect>
          </div>
          <div className="space-y-1">
            <Label htmlFor="metricAgg" className="text-xs">Aggregation</Label>
            <NativeSelect id="metricAgg" name="metricAgg" defaultValue={metric.metricAgg}>
              <option value="once">Once per user</option>
              <option value="count">Count all</option>
              <option value="sum">Sum values</option>
            </NativeSelect>
          </div>
        </div>

        <div className="space-y-1">
          <Label htmlFor="metricDescription" className="text-xs">
            Description{" "}
            <span className="text-muted-foreground/60">(optional)</span>
          </Label>
          <Textarea
            id="metricDescription"
            name="metricDescription"
            defaultValue={metric.description}
            placeholder="What does this metric measure and why does it matter?"
            rows={2}
            className="text-xs resize-none"
          />
        </div>
      </fieldset>

      {/* ── Guardrails ── */}
      <fieldset className="space-y-2 rounded-lg border px-3 pb-3 pt-2">
        <legend className="px-1 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
          Guardrails
        </legend>
        <p className="text-[10px] text-muted-foreground">
          Metrics that must not regress for this experiment to ship.
        </p>
        <GuardrailsEditor initialRows={guardrailRows} />
      </fieldset>

      <DialogFooter className="gap-2 pt-1">
        <Button type="button" variant="outline" size="sm" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" size="sm">Save</Button>
      </DialogFooter>
    </form>
  );
}

/**
 * Pencil button + structured dialog for editing Primary Metric and Guardrails.
 */
export function MetricEditDialog({ experiment }: { experiment: Experiment }) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="ml-1 text-muted-foreground/50 hover:text-foreground transition-colors"
        title="Edit metrics"
      >
        <Pencil className="size-3" />
      </button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-sm">Edit Experiment Metrics</DialogTitle>
          </DialogHeader>

          {open && (
            <MetricEditForm
              experiment={experiment}
              onDone={() => setOpen(false)}
              onCancel={() => setOpen(false)}
            />
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
