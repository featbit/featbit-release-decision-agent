"use client";

import { useState } from "react";
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
import { Plus, X, Beaker, Target, ShieldCheck, Sigma, Database, Calendar } from "lucide-react";
import { cn } from "@/lib/utils";
import { saveExpertSetupAction } from "@/lib/actions";
import type { Experiment, ExperimentRun } from "@/generated/prisma";

/* ── Types ── */
type GuardrailRow = {
  name: string;
  event: string;
  description: string;
  inverse: boolean;
  metricType: string;          // "binary" | "numeric"
  dataRows: DataRow[];         // observed data per variant (optional)
};
type DataRow = { variant: string; n: string; s: string; ss: string };

/* ── Parse helpers: reuse logic from metric-edit and analyze route ── */
function parsePrimaryMetric(value: string | null | undefined) {
  if (!value) return {
    name: "", event: "", metricType: "binary", metricAgg: "once", description: "", inverse: false,
  };
  try {
    const p = JSON.parse(value);
    if (p && typeof p === "object") {
      return {
        name: p.name ?? "",
        event: p.event ?? "",
        metricType: p.metricType ?? "binary",
        metricAgg: p.metricAgg ?? "once",
        description: p.description ?? "",
        inverse: Boolean(p.inverse),
      };
    }
  } catch {/* ignore */}
  return { name: value, event: "", metricType: "binary", metricAgg: "once", description: "", inverse: false };
}

function parseGuardrails(value: string | null | undefined): GuardrailRow[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    if (Array.isArray(parsed)) {
      return parsed.map((g) => ({
        name: g.name ?? g.event ?? "",
        event: g.event ?? "",
        description: g.description ?? "",
        inverse: Boolean(g.inverse),
        metricType: g.metricType ?? "binary",
        dataRows: Array.isArray(g.dataRows)
          ? g.dataRows.map((r: Partial<DataRow>) => ({
              variant: r.variant ?? "",
              n: r.n ?? "",
              s: r.s ?? "",
              ss: r.ss ?? "",
            }))
          : [],
      }));
    }
  } catch {/* ignore */}
  return [];
}

/**
 * Merge any per-guardrail observed data already persisted in inputData back
 * into the GuardrailRow list, so the wizard re-prefills on "Edit setup".
 */
function hydrateGuardrailsWithData(
  guardrails: GuardrailRow[],
  inputDataRaw: string | null | undefined,
): GuardrailRow[] {
  if (!inputDataRaw) return guardrails;
  try {
    const parsed = JSON.parse(inputDataRaw);
    const metrics = parsed?.metrics;
    if (!metrics || typeof metrics !== "object") return guardrails;
    return guardrails.map((g) => {
      if (!g.event || g.dataRows.length > 0) return g;
      const mData = metrics[g.event];
      if (!mData || typeof mData !== "object") return g;
      const rows: DataRow[] = Object.entries(
        mData as Record<string, { n?: number; k?: number; sum?: number; sum_squares?: number } | unknown>,
      )
        .filter(([k]) => k !== "inverse")
        .map(([variant, raw]) => {
          const v = raw as { n?: number; k?: number; sum?: number; sum_squares?: number };
          return {
            variant,
            n: String(v?.n ?? ""),
            s: String(v?.k ?? v?.sum ?? ""),
            ss: v?.sum_squares != null ? String(v.sum_squares) : "",
          };
        });
      return { ...g, dataRows: rows };
    });
  } catch { return guardrails; }
}

function parseInputDataToRows(
  raw: string | null | undefined,
  eventName: string,
): DataRow[] {
  if (!raw || !eventName) return [];
  try {
    const parsed = JSON.parse(raw);
    const metric = parsed?.metrics?.[eventName];
    if (!metric || typeof metric !== "object") return [];
    return Object.entries(
      metric as Record<string, { n?: number; k?: number; sum?: number; sum_squares?: number } | unknown>,
    )
      .filter(([k]) => k !== "inverse")
      .map(([variant, raw]) => {
        const v = raw as { n?: number; k?: number; sum?: number; sum_squares?: number };
        return {
          variant,
          n: String(v?.n ?? ""),
          s: String(v?.k ?? v?.sum ?? ""),
          ss: v?.sum_squares != null ? String(v.sum_squares) : "",
        };
      });
  } catch { return []; }
}

function toDateInput(d: Date | string | null | undefined): string {
  if (!d) return "";
  const date = typeof d === "string" ? new Date(d) : d;
  if (isNaN(date.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/**
 * Build a natural-language summary of the saved wizard state so the chat
 * agent can acknowledge what the user entered and offer an analysis.
 * Read directly from FormData (already validated) to avoid threading every
 * field through React state.
 */
function buildChatSummary(formData: FormData): string {
  const get = (k: string) => ((formData.get(k) as string | null) ?? "").trim();
  const method = get("method") === "bandit" ? "Multi-armed bandit" : "Bayesian A/B";
  const metricName = get("metricName");
  const metricEvent = get("metricEvent");
  const metricType = get("metricType") || "binary";
  const metricAgg = get("metricAgg") || "once";
  const primaryInverse = formData.get("primaryInverse") != null;
  const priorMode = get("priorMode") || "flat";
  const priorMean = get("priorMean");
  const priorStddev = get("priorStddev");
  const minSample = get("minimumSample");
  const obsStart = get("observationStart");
  const obsEnd = get("observationEnd");
  const control = get("controlVariant");
  const treatment = get("treatmentVariant");

  type GuardrailIn = { name?: string; event?: string; inverse?: boolean; metricType?: string; dataRows?: unknown[] };
  let guardrails: GuardrailIn[] = [];
  try {
    const parsed = JSON.parse(get("guardrails") || "[]");
    if (Array.isArray(parsed)) guardrails = parsed;
  } catch {/* ignore */}

  type DataRowIn = { variant?: string; n?: string; s?: string };
  let primaryRowCount = 0;
  try {
    const rows = JSON.parse(get("dataRows") || "[]") as DataRowIn[];
    primaryRowCount = rows.filter(
      (r) => r.variant?.trim() && r.n && Number(r.n) > 0,
    ).length;
  } catch {/* ignore */}

  const guardrailsWithData = guardrails.filter(
    (g) => Array.isArray(g.dataRows) && g.dataRows.some((r: unknown) => {
      const row = r as DataRowIn;
      return row.variant?.trim() && row.n && Number(row.n) > 0;
    }),
  ).length;

  const lines: string[] = [];
  lines.push("I just finished the expert setup wizard. Here's what I entered — please pull the experiment state and confirm you see the same thing:");
  lines.push("");
  lines.push(`- **Algorithm:** ${method}`);
  lines.push(
    `- **Primary metric:** ${metricName || "(no name)"} — \`${metricEvent}\`` +
    ` (${metricType}, counted ${metricAgg}${primaryInverse ? ", lower is better" : ""})`,
  );
  if (guardrails.length > 0) {
    lines.push(`- **Guardrails (${guardrails.length}):** ` +
      guardrails.map((g) =>
        `\`${g.event || g.name}\`${g.inverse ? " ↓" : ""}`,
      ).join(", "));
  }
  lines.push(`- **Variants:** control=\`${control}\`, treatment(s)=\`${treatment}\``);
  lines.push(
    `- **Prior:** ${priorMode === "proper"
      ? `informative (mean=${priorMean || "?"}, σ=${priorStddev || "?"})`
      : "flat (uninformative)"}`,
  );
  if (minSample) lines.push(`- **Minimum sample per variant:** ${minSample}`);
  if (obsStart || obsEnd) {
    lines.push(`- **Observation window:** ${obsStart || "—"} → ${obsEnd || "—"}`);
  }
  if (primaryRowCount > 0) {
    lines.push(`- **Observed data:** pasted for ${primaryRowCount} primary variant row(s)` +
      (guardrailsWithData > 0 ? ` + ${guardrailsWithData} guardrail(s)` : ""));
  } else {
    lines.push("- **Observed data:** not provided yet");
  }
  lines.push("");
  if (primaryRowCount > 0) {
    lines.push("Data is in — please run the Bayesian analysis on this run and walk me through what it means (signal, guardrail risk, what to do next).");
  } else {
    lines.push("I haven't pasted data yet. What's the right next step — should I wait for data, or do you need more setup info first?");
  }
  return lines.join("\n");
}

function NativeSelect({
  id, name, defaultValue, children,
}: { id: string; name: string; defaultValue: string; children: React.ReactNode }) {
  return (
    <select
      id={id}
      name={name}
      defaultValue={defaultValue}
      className={cn(
        "h-8 w-full rounded-lg border border-input bg-transparent px-2.5 py-1 text-sm",
        "transition-colors outline-none",
        "focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50",
      )}
    >
      {children}
    </select>
  );
}

/* ── Algorithm picker (radio cards) ── */
function AlgorithmPicker({ defaultValue }: { defaultValue: string }) {
  const [value, setValue] = useState(defaultValue);
  return (
    <div className="grid grid-cols-2 gap-2">
      <input type="hidden" name="method" value={value} />
      {[
        { key: "bayesian_ab", label: "Bayesian A/B", desc: "Fixed traffic split, posterior inference." },
        { key: "bandit", label: "Multi-armed bandit", desc: "Adaptive allocation toward winning arm." },
      ].map((opt) => (
        <button
          type="button"
          key={opt.key}
          onClick={() => setValue(opt.key)}
          className={cn(
            "rounded-md border px-3 py-2 text-left transition-colors",
            value === opt.key
              ? "border-foreground bg-foreground/5"
              : "hover:bg-muted/40",
          )}
        >
          <div className="text-xs font-semibold">{opt.label}</div>
          <div className="text-[10px] text-muted-foreground mt-0.5 leading-tight">
            {opt.desc}
          </div>
        </button>
      ))}
    </div>
  );
}

/* ── Prior picker ── */
function PriorPicker({
  defaultMode, defaultMean, defaultStddev,
}: { defaultMode: "flat" | "proper"; defaultMean: string; defaultStddev: string }) {
  const [mode, setMode] = useState<"flat" | "proper">(defaultMode);
  return (
    <div className="space-y-2">
      <input type="hidden" name="priorMode" value={mode} />
      <div className="grid grid-cols-2 gap-2">
        {[
          { key: "flat" as const, label: "Flat prior", desc: "No prior belief — fully data-driven." },
          { key: "proper" as const, label: "Informative prior", desc: "Use past data as a Gaussian prior." },
        ].map((opt) => (
          <button
            type="button"
            key={opt.key}
            onClick={() => setMode(opt.key)}
            className={cn(
              "rounded-md border px-3 py-2 text-left transition-colors",
              mode === opt.key ? "border-foreground bg-foreground/5" : "hover:bg-muted/40",
            )}
          >
            <div className="text-xs font-semibold">{opt.label}</div>
            <div className="text-[10px] text-muted-foreground mt-0.5 leading-tight">
              {opt.desc}
            </div>
          </button>
        ))}
      </div>
      {mode === "proper" && (
        <div className="grid grid-cols-2 gap-3 pt-1">
          <div className="space-y-1">
            <Label htmlFor="priorMean" className="text-xs">Prior mean</Label>
            <Input
              id="priorMean"
              name="priorMean"
              type="number"
              step="0.0001"
              defaultValue={defaultMean}
              placeholder="e.g. 0.1"
              className="text-sm"
            />
            <p className="text-[10px] text-muted-foreground">
              Expected baseline rate / mean from prior data.
            </p>
          </div>
          <div className="space-y-1">
            <Label htmlFor="priorStddev" className="text-xs">Prior stddev</Label>
            <Input
              id="priorStddev"
              name="priorStddev"
              type="number"
              step="0.0001"
              defaultValue={defaultStddev}
              placeholder="e.g. 0.3"
              className="text-sm"
            />
            <p className="text-[10px] text-muted-foreground">
              Uncertainty around the prior mean.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

/* ── Guardrails editor (reuses metric-edit pattern, adds event name) ── */
function GuardrailsEditor({
  initial,
  defaultVariants,
}: {
  initial: GuardrailRow[];
  defaultVariants: string[];
}) {
  const [rows, setRows] = useState<GuardrailRow[]>(initial);

  function update<K extends keyof GuardrailRow>(i: number, field: K, v: GuardrailRow[K]) {
    setRows((prev) => prev.map((r, idx) => (idx === i ? { ...r, [field]: v } : r)));
  }
  function add() {
    setRows((prev) => [
      ...prev,
      {
        name: "", event: "", description: "", inverse: false,
        metricType: "binary",
        dataRows: defaultVariants.map((v) => ({ variant: v, n: "", s: "", ss: "" })),
      },
    ]);
  }
  function remove(i: number) { setRows((prev) => prev.filter((_, idx) => idx !== i)); }

  return (
    <div className="space-y-2">
      <input type="hidden" name="guardrails" value={JSON.stringify(rows)} />
      {rows.map((row, i) => (
        <div key={i} className="rounded-md border px-2.5 py-2 space-y-2 relative">
          <button
            type="button"
            onClick={() => remove(i)}
            className="absolute top-2 right-2 text-muted-foreground/40 hover:text-destructive"
            title="Remove"
          >
            <X className="size-3" />
          </button>
          <div className="grid grid-cols-2 gap-2 pr-5">
            <div className="space-y-1">
              <Label className="text-[10px] uppercase text-muted-foreground">Name</Label>
              <Input
                value={row.name}
                onChange={(e) => update(i, "name", e.target.value)}
                placeholder="Checkout abandonment"
                className="text-xs h-7"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-[10px] uppercase text-muted-foreground">Event</Label>
              <Input
                value={row.event}
                onChange={(e) => update(i, "event", e.target.value)}
                placeholder="checkout_abandoned"
                className="text-xs font-mono h-7"
              />
            </div>
          </div>
          <div className="grid grid-cols-[1fr_auto] gap-2 pr-5 items-end">
            <div className="space-y-1">
              <Label className="text-[10px] uppercase text-muted-foreground">Description</Label>
              <Textarea
                value={row.description}
                onChange={(e) => update(i, "description", e.target.value)}
                placeholder="Must not regress"
                rows={1}
                className="text-xs resize-none"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-[10px] uppercase text-muted-foreground">Type</Label>
              <select
                value={row.metricType}
                onChange={(e) => update(i, "metricType", e.target.value)}
                className={cn(
                  "h-7 rounded-lg border border-input bg-transparent px-2 py-0 text-xs",
                  "transition-colors outline-none",
                  "focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50",
                )}
              >
                <option value="binary">Binary</option>
                <option value="numeric">Numeric</option>
              </select>
            </div>
          </div>
          <label className="flex items-center gap-2 text-[11px] text-muted-foreground cursor-pointer select-none">
            <input
              type="checkbox"
              checked={row.inverse}
              onChange={(e) => update(i, "inverse", e.target.checked)}
              className="size-3.5"
            />
            <span>
              Lower is better (inverse) — analyzer treats an increase as a
              regression (e.g. latency, error rate).
            </span>
          </label>

          {/* Observed data for this guardrail */}
          <GuardrailDataTable
            metricType={row.metricType}
            rows={row.dataRows.length > 0
              ? row.dataRows
              : defaultVariants.map((v) => ({ variant: v, n: "", s: "", ss: "" }))}
            onChange={(next) => update(i, "dataRows", next)}
          />
        </div>
      ))}
      <button
        type="button"
        onClick={add}
        className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
      >
        <Plus className="size-3" />
        Add guardrail
      </button>
    </div>
  );
}

/* ── Nested data table inside each guardrail row ── */
function GuardrailDataTable({
  rows,
  metricType,
  onChange,
}: {
  rows: DataRow[];
  metricType: string;
  onChange: (next: DataRow[]) => void;
}) {
  const isNumeric = metricType === "numeric";
  const gridCols = isNumeric
    ? "grid-cols-[1fr_1fr_1fr_1fr_auto]"
    : "grid-cols-[1fr_1fr_1fr_auto]";

  function update(i: number, field: keyof DataRow, v: string) {
    onChange(rows.map((r, idx) => (idx === i ? { ...r, [field]: v } : r)));
  }
  function add() { onChange([...rows, { variant: "", n: "", s: "", ss: "" }]); }
  function remove(i: number) { onChange(rows.filter((_, idx) => idx !== i)); }

  return (
    <div className="space-y-1.5 rounded-md bg-muted/20 px-2 py-2">
      <div className="text-[10px] uppercase text-muted-foreground font-medium">
        Observed data <span className="text-muted-foreground/50">(optional)</span>
      </div>
      <div className={`grid ${gridCols} gap-2 text-[10px] uppercase text-muted-foreground/70 px-1`}>
        <span>Variant</span>
        <span>Users (n)</span>
        <span>{isNumeric ? "Sum" : "k"}</span>
        {isNumeric && <span>Sum of sq.</span>}
        <span />
      </div>
      {rows.map((row, i) => (
        <div key={i} className={`grid ${gridCols} gap-2 items-center`}>
          <Input
            value={row.variant}
            onChange={(e) => update(i, "variant", e.target.value)}
            placeholder="control"
            className="text-xs font-mono h-6"
          />
          <Input
            type="number" step="1" min="0"
            value={row.n}
            onChange={(e) => update(i, "n", e.target.value)}
            placeholder="1000"
            className="text-xs h-6"
          />
          <Input
            type="number" step="0.01" min="0"
            value={row.s}
            onChange={(e) => update(i, "s", e.target.value)}
            placeholder={isNumeric ? "4250.5" : "150"}
            className="text-xs h-6"
          />
          {isNumeric && (
            <Input
              type="number" step="0.01" min="0"
              value={row.ss}
              onChange={(e) => update(i, "ss", e.target.value)}
              placeholder="27500"
              className="text-xs h-6"
            />
          )}
          <button
            type="button"
            onClick={() => remove(i)}
            className="text-muted-foreground/40 hover:text-destructive"
            title="Remove"
          >
            <X className="size-3" />
          </button>
        </div>
      ))}
      <button
        type="button"
        onClick={add}
        className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground"
      >
        <Plus className="size-3" />
        Add variant row
      </button>
    </div>
  );
}

/* ── Variant data table ── */
function VariantsDataEditor({
  initial, metricType,
}: { initial: DataRow[]; metricType: string }) {
  const base: DataRow[] = initial.length > 0
    ? initial
    : [
        { variant: "control", n: "", s: "", ss: "" },
        { variant: "treatment", n: "", s: "", ss: "" },
      ];
  const [rows, setRows] = useState<DataRow[]>(base);
  const isNumeric = metricType === "numeric";

  function update(i: number, field: keyof DataRow, v: string) {
    setRows((prev) => prev.map((r, idx) => (idx === i ? { ...r, [field]: v } : r)));
  }
  function add() { setRows((prev) => [...prev, { variant: "", n: "", s: "", ss: "" }]); }
  function remove(i: number) { setRows((prev) => prev.filter((_, idx) => idx !== i)); }

  const gridCols = isNumeric
    ? "grid-cols-[1fr_1fr_1fr_1fr_auto]"
    : "grid-cols-[1fr_1fr_1fr_auto]";

  return (
    <div className="space-y-2">
      <input type="hidden" name="dataRows" value={JSON.stringify(rows)} />
      <div className={`grid ${gridCols} gap-2 text-[10px] uppercase text-muted-foreground px-1`}>
        <span>Variant</span>
        <span>Users (n)</span>
        <span>{isNumeric ? "Sum of values" : "Conversions (k)"}</span>
        {isNumeric && <span>Sum of squares</span>}
        <span />
      </div>
      {rows.map((row, i) => (
        <div key={i} className={`grid ${gridCols} gap-2 items-center`}>
          <Input
            value={row.variant}
            onChange={(e) => update(i, "variant", e.target.value)}
            placeholder="control"
            className="text-xs font-mono h-7"
          />
          <Input
            type="number"
            step="1"
            min="0"
            value={row.n}
            onChange={(e) => update(i, "n", e.target.value)}
            placeholder="1000"
            className="text-xs h-7"
          />
          <Input
            type="number"
            step="0.01"
            min="0"
            value={row.s}
            onChange={(e) => update(i, "s", e.target.value)}
            placeholder={isNumeric ? "4250.5" : "150"}
            className="text-xs h-7"
          />
          {isNumeric && (
            <Input
              type="number"
              step="0.01"
              min="0"
              value={row.ss}
              onChange={(e) => update(i, "ss", e.target.value)}
              placeholder="27500"
              className="text-xs h-7"
            />
          )}
          <button
            type="button"
            onClick={() => remove(i)}
            className="text-muted-foreground/40 hover:text-destructive"
            title="Remove"
          >
            <X className="size-3" />
          </button>
        </div>
      ))}
      <button
        type="button"
        onClick={add}
        className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
      >
        <Plus className="size-3" />
        Add variant
      </button>
      <p className="text-[10px] text-muted-foreground leading-snug">
        {isNumeric ? (
          <>
            For <b>numeric</b> metrics the analyzer needs <i>n</i>, <i>sum</i>,
            and <i>sum of squares</i> to compute the per-variant variance.
          </>
        ) : (
          <>
            For <b>binary</b> metrics, provide the number of users (<i>n</i>)
            and the number of converters (<i>k</i>).
          </>
        )}{" "}
        Live data pulls from third-party warehouses aren&apos;t supported yet —
        paste totals here or skip and fill later.
      </p>
    </div>
  );
}

/* ── Section wrapper ── */
function Section({
  icon, title, subtitle, children,
}: { icon: React.ReactNode; title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <fieldset className="space-y-3 rounded-lg border px-3 pb-3 pt-2">
      <legend className="px-1 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        {icon}
        {title}
      </legend>
      {subtitle && <p className="text-[10px] text-muted-foreground -mt-1">{subtitle}</p>}
      {children}
    </fieldset>
  );
}

/* ── Main dialog ── */
export function ExpertSetupDialog({
  experiment,
  open,
  onOpenChange,
  onSaved,
}: {
  experiment: Experiment & { experimentRuns: ExperimentRun[] };
  open: boolean;
  onOpenChange: (v: boolean) => void;
  /** Fires after a successful save — receives a ready-to-send chat summary. */
  onSaved?: (chatSummary: string) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-sm">Expert experiment setup</DialogTitle>
          <p className="text-[11px] text-muted-foreground">
            Configure the algorithm, metrics, and priors directly. You can edit
            any of this later.
          </p>
        </DialogHeader>
        {open && (
          <ExpertSetupForm
            experiment={experiment}
            onDone={() => onOpenChange(false)}
            onSaved={onSaved}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function ExpertSetupForm({
  experiment,
  onDone,
  onSaved,
}: {
  experiment: Experiment & { experimentRuns: ExperimentRun[] };
  onDone: () => void;
  onSaved?: (chatSummary: string) => void;
}) {
  // Prefill from the first existing run if any, else from experiment fields.
  const existingRun = experiment.experimentRuns[0];
  const metric = parsePrimaryMetric(experiment.primaryMetric);
  const guardrailRows = hydrateGuardrailsWithData(
    parseGuardrails(experiment.guardrails),
    existingRun?.inputData,
  );

  const method = existingRun?.method ?? "bayesian_ab";
  const priorMode = existingRun?.priorProper ? "proper" : "flat";
  const priorMean = existingRun?.priorMean != null ? String(existingRun.priorMean) : "";
  const priorStddev = existingRun?.priorStddev != null ? String(existingRun.priorStddev) : "";
  const minimumSample = existingRun?.minimumSample != null ? String(existingRun.minimumSample) : "";
  const controlVariant = existingRun?.controlVariant ?? "control";
  const treatmentVariant = existingRun?.treatmentVariant ?? "treatment";
  const dataRows = parseInputDataToRows(existingRun?.inputData, existingRun?.primaryMetricEvent ?? metric.event);

  // Controlled state so nested sub-editors (variant hints for guardrails) react.
  const [metricType, setMetricType] = useState<string>(metric.metricType);
  const [primaryInverse, setPrimaryInverse] = useState<boolean>(metric.inverse);
  const [controlName, setControlName] = useState<string>(controlVariant);
  const [treatmentNames, setTreatmentNames] = useState<string>(treatmentVariant);
  const defaultVariants = [
    controlName.trim() || "control",
    ...treatmentNames
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
  ];

  return (
    <form
      action={async (formData) => {
        await saveExpertSetupAction(formData);
        onSaved?.(buildChatSummary(formData));
        onDone();
      }}
      className="space-y-4 pt-1"
    >
      <input type="hidden" name="experimentId" value={experiment.id} />
      {existingRun && (
        <input type="hidden" name="experimentRunId" value={existingRun.id} />
      )}

      {/* ── Algorithm ── */}
      <Section icon={<Beaker className="size-3.5" />} title="Algorithm">
        <AlgorithmPicker defaultValue={method} />
      </Section>

      {/* ── Primary metric (North Star) ── */}
      <Section
        icon={<Target className="size-3.5" />}
        title="Primary Metric (North Star)"
      >
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <Label htmlFor="metricName" className="text-xs">Name</Label>
            <Input
              id="metricName"
              name="metricName"
              defaultValue={metric.name}
              placeholder="Checkout completion rate"
              className="text-sm"
              required
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="metricEvent" className="text-xs">Event</Label>
            <Input
              id="metricEvent"
              name="metricEvent"
              defaultValue={metric.event}
              placeholder="purchase_completed"
              className="text-sm font-mono"
              required
            />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <Label htmlFor="metricType" className="text-xs">Type</Label>
            <select
              id="metricType"
              name="metricType"
              value={metricType}
              onChange={(e) => setMetricType(e.target.value)}
              className={cn(
                "h-8 w-full rounded-lg border border-input bg-transparent px-2.5 py-1 text-sm",
                "transition-colors outline-none",
                "focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50",
              )}
            >
              <option value="binary">Binary (conversion)</option>
              <option value="numeric">Numeric (value)</option>
            </select>
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
            Description <span className="text-muted-foreground/60">(optional)</span>
          </Label>
          <Textarea
            id="metricDescription"
            name="metricDescription"
            defaultValue={metric.description}
            rows={2}
            className="text-xs resize-none"
            placeholder="What does this measure and why does it matter?"
          />
        </div>
        <label className="flex items-center gap-2 text-[11px] text-muted-foreground cursor-pointer select-none">
          <input
            type="checkbox"
            name="primaryInverse"
            checked={primaryInverse}
            onChange={(e) => setPrimaryInverse(e.target.checked)}
            className="size-3.5"
          />
          <span>
            Lower is better (inverse) — check for metrics where a decrease is
            the win (latency, error rate, drop-off).
          </span>
        </label>
      </Section>

      {/* ── Guardrails ── */}
      <Section
        icon={<ShieldCheck className="size-3.5" />}
        title="Guardrails"
        subtitle="Metrics that must not regress. Add observed data per guardrail to include it in analysis."
      >
        <GuardrailsEditor initial={guardrailRows} defaultVariants={defaultVariants} />
      </Section>

      {/* ── Priors & min sample ── */}
      <Section icon={<Sigma className="size-3.5" />} title="Prior & Stopping">
        <PriorPicker
          defaultMode={priorMode}
          defaultMean={priorMean}
          defaultStddev={priorStddev}
        />
        <div className="space-y-1">
          <Label htmlFor="minimumSample" className="text-xs">Minimum sample per variant</Label>
          <Input
            id="minimumSample"
            name="minimumSample"
            type="number"
            step="1"
            min="0"
            defaultValue={minimumSample}
            placeholder="e.g. 500"
            className="text-sm"
          />
          <p className="text-[10px] text-muted-foreground">
            Analysis stays INCONCLUSIVE until each variant reaches this sample
            size. Leave blank for no minimum.
          </p>
        </div>
      </Section>

      {/* ── Observation window ── */}
      <Section
        icon={<Calendar className="size-3.5" />}
        title="Observation Window"
        subtitle="When did / will this experiment collect data? Leave blank to let the analyzer default to the last 30 days."
      >
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <Label htmlFor="observationStart" className="text-xs">Start</Label>
            <Input
              id="observationStart"
              name="observationStart"
              type="date"
              defaultValue={toDateInput(existingRun?.observationStart)}
              className="text-sm"
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="observationEnd" className="text-xs">End</Label>
            <Input
              id="observationEnd"
              name="observationEnd"
              type="date"
              defaultValue={toDateInput(existingRun?.observationEnd)}
              className="text-sm"
            />
          </div>
        </div>
      </Section>

      {/* ── Variants + data ── */}
      <Section
        icon={<Database className="size-3.5" />}
        title="Observed Data"
        subtitle="Provide totals now or skip and fill in later."
      >
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <Label htmlFor="controlVariant" className="text-xs">Control variant</Label>
            <Input
              id="controlVariant"
              name="controlVariant"
              value={controlName}
              onChange={(e) => setControlName(e.target.value)}
              placeholder="control"
              className="text-sm font-mono"
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="treatmentVariant" className="text-xs">Treatment variant(s)</Label>
            <Input
              id="treatmentVariant"
              name="treatmentVariant"
              value={treatmentNames}
              onChange={(e) => setTreatmentNames(e.target.value)}
              placeholder="treatment"
              className="text-sm font-mono"
            />
            <p className="text-[10px] text-muted-foreground">
              Comma-separated for multiple arms (bandit).
            </p>
          </div>
        </div>
        <VariantsDataEditor initial={dataRows} metricType={metricType} />
      </Section>

      <DialogFooter className="gap-2 pt-1">
        <Button type="button" variant="outline" size="sm" onClick={onDone}>
          Cancel
        </Button>
        <Button type="submit" size="sm">Save setup</Button>
      </DialogFooter>
    </form>
  );
}
