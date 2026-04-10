"use client";

import { useState } from "react";
import {
  Beaker,
  Calendar,
  ChevronDown,
  Filter,
  Flag,
  Info,
  Lightbulb,
  ShieldCheck,
  Target,
  TrendingUp,
  Users,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { AnalysisView } from "./analysis-markdown";
import { ExperimentTrafficConfig } from "./experiment-traffic-config";
import type { Experiment } from "@/generated/prisma/client";

/* ── Colour maps ── */

const DECISION_BG: Record<string, string> = {
  CONTINUE:
    "bg-green-50 border-green-200 dark:bg-green-950/30 dark:border-green-800",
  PAUSE:
    "bg-yellow-50 border-yellow-200 dark:bg-yellow-950/30 dark:border-yellow-800",
  ROLLBACK_CANDIDATE:
    "bg-red-50 border-red-200 dark:bg-red-950/30 dark:border-red-800",
  INCONCLUSIVE:
    "bg-gray-50 border-gray-200 dark:bg-gray-900/30 dark:border-gray-700",
};

const DECISION_COLORS: Record<string, string> = {
  CONTINUE:
    "bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300",
  PAUSE:
    "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/40 dark:text-yellow-300",
  ROLLBACK_CANDIDATE:
    "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300",
  INCONCLUSIVE:
    "bg-gray-100 text-gray-700 dark:bg-gray-800/40 dark:text-gray-300",
};

/* ── Shared primitive components ── */

function SectionLabel({
  icon,
  label,
}: {
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <div className="flex items-center gap-1 text-[10px] font-medium text-muted-foreground uppercase tracking-wider mb-0.5">
      {icon}
      <span>{label}</span>
    </div>
  );
}

function MethodBadge({ method }: { method: string }) {
  const label = method === "bandit" ? "Bandit" : "Bayesian A/B";
  const color =
    method === "bandit"
      ? "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300"
      : "bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300";
  return (
    <Badge className={`text-[10px] px-1.5 py-0 ${color}`}>
      <Beaker className="inline size-2.5 mr-0.5" />
      {label}
    </Badge>
  );
}

function StatusBadge({ status }: { status: string }) {
  const color =
    status === "decided"
      ? "bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300"
      : status === "running"
        ? "bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300"
        : "";
  return (
    <Badge variant="outline" className={`text-[10px] ${color}`}>
      {status}
    </Badge>
  );
}

function DecisionBadge({ decision }: { decision: string | null }) {
  if (!decision) {
    return (
      <Badge variant="outline" className="text-[10px] text-muted-foreground/60">
        Pending
      </Badge>
    );
  }
  const color = DECISION_COLORS[decision] ?? "";
  return (
    <Badge className={`text-[10px] px-1.5 py-0 ${color}`}>{decision}</Badge>
  );
}

/* ── Helpers ── */

function parseGuardrailDescriptions(
  raw: string | null | undefined
): Record<string, string> {
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

function parseGuardrailEvents(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v : [raw];
  } catch {
    return [raw];
  }
}

function fmtDate(d: Date | string): string {
  const date = typeof d === "string" ? new Date(d) : d;
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

/* ── Detail panel (content inside the Sheet) ── */

function ExperimentDetail({
  exp,
  index,
  isSequential,
  projectId,
}: {
  exp: Experiment;
  index: number;
  isSequential: boolean;
  projectId: string;
}) {
  const guardrailDescs = parseGuardrailDescriptions(exp.guardrailDescriptions);
  const guardrailEvents = parseGuardrailEvents(exp.guardrailEvents);
  const hasDecision = Boolean(exp.decision);

  return (
    <div className="px-4 pb-6 space-y-4 overflow-y-auto">
      {/* Decision callout — prominent */}
      {exp.decisionSummary && (
        <div
          className={`rounded-md border px-3 py-2.5 ${DECISION_BG[exp.decision ?? ""] ?? "bg-muted/30 border-border"}`}
        >
          <p className="text-sm font-medium leading-relaxed">
            {exp.decisionSummary}
          </p>
        </div>
      )}

      {/* Technical rationale */}
      {exp.decisionReason && (
        <div>
          <SectionLabel
            icon={<Target className="size-3" />}
            label="Technical Rationale"
          />
          <p className="text-xs leading-relaxed text-muted-foreground">
            {exp.decisionReason}
          </p>
        </div>
      )}

      {/* Hypothesis */}
      {exp.hypothesis && (
        <div>
          <SectionLabel
            icon={<Lightbulb className="size-3" />}
            label="Hypothesis"
          />
          <p className="text-xs leading-relaxed text-muted-foreground">
            {exp.hypothesis}
          </p>
        </div>
      )}

      {/* Method reason */}
      {exp.methodReason && (
        <div>
          <SectionLabel
            icon={<Info className="size-3" />}
            label="Why This Method"
          />
          <p className="text-xs leading-relaxed text-muted-foreground">
            {exp.methodReason}
          </p>
        </div>
      )}

      {/* Primary metric */}
      <div>
        <SectionLabel
          icon={<TrendingUp className="size-3" />}
          label="Primary Metric"
        />
        <p className="text-xs font-mono">{exp.primaryMetricEvent || "—"}</p>
        {exp.metricDescription && (
          <p className="text-[10px] text-muted-foreground mt-0.5">
            {exp.metricDescription}
          </p>
        )}
      </div>

      {/* Guardrails */}
      {guardrailEvents.length > 0 && (
        <div>
          <SectionLabel
            icon={<ShieldCheck className="size-3" />}
            label="Guardrails"
          />
          <ul className="space-y-0.5">
            {guardrailEvents.map((evt) => (
              <li key={evt} className="text-xs">
                <span className="font-mono">{evt}</span>
                {guardrailDescs[evt] && (
                  <span className="text-[10px] text-muted-foreground ml-1">
                    — {guardrailDescs[evt]}
                  </span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Variants */}
      {exp.method === "bandit" ? (
        <div>
          <SectionLabel icon={<Users className="size-3" />} label="Arms" />
          <div className="flex flex-wrap gap-1.5 mt-0.5">
            {[
              exp.controlVariant,
              ...(exp.treatmentVariant
                ?.split("|")
                .map((s: string) => s.trim()) ?? []),
            ]
              .filter(Boolean)
              .map((arm) => (
                <span
                  key={arm}
                  className="inline-flex items-center rounded border px-1.5 py-0.5 text-xs font-mono bg-muted/40"
                >
                  {arm}
                  {arm === exp.controlVariant && (
                    <span className="ml-1 text-[10px] text-muted-foreground">
                      (baseline)
                    </span>
                  )}
                </span>
              ))}
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
          {exp.controlVariant && (
            <span>
              <Users className="inline size-3 mr-0.5" />
              <span className="text-muted-foreground">Control:</span>{" "}
              <span className="font-mono">{exp.controlVariant}</span>
            </span>
          )}
          {exp.treatmentVariant && (
            <span>
              <span className="text-muted-foreground">Treatment:</span>{" "}
              <span className="font-mono">{exp.treatmentVariant}</span>
            </span>
          )}
        </div>
      )}

      {/* Sample + window */}
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
        {exp.minimumSample && (
          <span>
            Min sample:{" "}
            <span className="tabular-nums font-medium text-foreground">
              {exp.minimumSample}
            </span>
            /variant
          </span>
        )}
        {exp.observationStart && exp.observationEnd && (
          <span>
            <Calendar className="inline size-3 mr-0.5" />
            {fmtDate(exp.observationStart)} → {fmtDate(exp.observationEnd)}
          </span>
        )}
      </div>

      {/* Audience & Traffic */}
      <div>
        <SectionLabel
          icon={<Filter className="size-3" />}
          label="Audience & Traffic"
        />
        <ExperimentTrafficConfig experiment={exp} projectId={projectId} />
      </div>

      {/* Traffic allocation blob */}
      {exp.trafficAllocation && (
        <div>
          <SectionLabel
            icon={<Flag className="size-3" />}
            label="Traffic Allocation"
          />
          <p className="text-xs leading-relaxed text-muted-foreground">
            {exp.trafficAllocation}
          </p>
        </div>
      )}

      {/* Full analysis — auto-open when decision exists */}
      {exp.analysisResult && (
        <details className="group" open={hasDecision}>
          <summary className="flex items-center gap-1 cursor-pointer text-[10px] font-medium text-muted-foreground uppercase tracking-wider hover:text-foreground transition-colors select-none">
            <ChevronDown className="size-3 transition-transform group-open:rotate-180" />
            Full Analysis
          </summary>
          <div className="mt-1.5 rounded border bg-muted/20 px-2 py-1.5 overflow-x-auto">
            <AnalysisView content={exp.analysisResult} />
          </div>
        </details>
      )}
    </div>
  );
}

/* ── Main export: compact table + sheet drawer ── */

export function ExperimentTable({
  experiments,
  projectId,
  isSequential,
}: {
  experiments: Experiment[];
  projectId: string;
  isSequential: boolean;
}) {
  const [selected, setSelected] = useState<Experiment | null>(null);
  const selectedIndex = selected
    ? experiments.findIndex((e) => e.id === selected.id)
    : -1;

  return (
    <>
      {experiments.length === 0 ? (
        <div className="rounded-md border border-dashed p-3 text-center">
          <p className="text-xs text-muted-foreground/60">No experiments yet</p>
          <p className="text-[10px] text-muted-foreground/40 mt-1">
            Experiments will appear here once the agent sets them up.
          </p>
        </div>
      ) : (
        <div className="rounded-md border overflow-hidden">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b bg-muted/40 text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
                <th className="px-3 py-2 text-left w-8">#</th>
                <th className="px-3 py-2 text-left">Experiment</th>
                <th className="px-3 py-2 text-left hidden sm:table-cell">
                  Method
                </th>
                <th className="px-3 py-2 text-left hidden md:table-cell">
                  Primary Metric
                </th>
                <th className="px-3 py-2 text-left">Status</th>
                <th className="px-3 py-2 text-left">Decision</th>
                <th className="px-3 py-2 text-right w-20"></th>
              </tr>
            </thead>
            <tbody>
              {experiments.map((exp, idx) => (
                <tr
                  key={exp.id}
                  className="border-b last:border-0 hover:bg-muted/20 transition-colors"
                >
                  <td className="px-3 py-2.5 text-muted-foreground tabular-nums">
                    {isSequential ? (
                      <Badge
                        variant="outline"
                        className="text-[10px] px-1.5 py-0"
                      >
                        P{idx + 1}
                      </Badge>
                    ) : (
                      `${idx + 1}`
                    )}
                  </td>
                  <td className="px-3 py-2.5">
                    <span className="font-mono font-medium">{exp.slug}</span>
                  </td>
                  <td className="px-3 py-2.5 hidden sm:table-cell">
                    {exp.method ? (
                      <MethodBadge method={exp.method} />
                    ) : (
                      <span className="text-muted-foreground/40">—</span>
                    )}
                  </td>
                  <td className="px-3 py-2.5 hidden md:table-cell">
                    {exp.primaryMetricEvent ? (
                      <span className="font-mono text-[11px]">
                        {exp.primaryMetricEvent}
                      </span>
                    ) : (
                      <span className="text-muted-foreground/40">—</span>
                    )}
                  </td>
                  <td className="px-3 py-2.5">
                    <StatusBadge status={exp.status} />
                  </td>
                  <td className="px-3 py-2.5">
                    <DecisionBadge decision={exp.decision} />
                  </td>
                  <td className="px-3 py-2.5 text-right">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-6 text-[11px] px-2"
                      onClick={() => setSelected(exp)}
                    >
                      Details →
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Sheet
        open={!!selected}
        onOpenChange={(open) => {
          if (!open) setSelected(null);
        }}
      >
        <SheetContent
          side="right"
          className="sm:max-w-xl w-[560px] p-0 overflow-y-auto flex flex-col gap-0"
        >
          {selected && (
            <>
              <SheetHeader className="px-4 pt-4 pb-3 border-b">
                <div className="flex items-center gap-2 flex-wrap">
                  {isSequential && selectedIndex >= 0 && (
                    <Badge variant="outline" className="text-[10px] px-1.5 py-0">
                      Phase {selectedIndex + 1}
                    </Badge>
                  )}
                  <SheetTitle className="font-mono text-sm">
                    {selected.slug}
                  </SheetTitle>
                  <div className="flex items-center gap-1.5 ml-auto">
                    {selected.method && (
                      <MethodBadge method={selected.method} />
                    )}
                    <StatusBadge status={selected.status} />
                    {selected.decision && (
                      <DecisionBadge decision={selected.decision} />
                    )}
                  </div>
                </div>
              </SheetHeader>
              <div className="flex-1 overflow-y-auto pt-3">
                <ExperimentDetail
                  exp={selected}
                  index={selectedIndex}
                  isSequential={isSequential}
                  projectId={projectId}
                />
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>
    </>
  );
}
