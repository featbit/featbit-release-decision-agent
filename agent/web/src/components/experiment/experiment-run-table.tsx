"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import {
  Beaker,
  Bot,
  Calendar,
  Filter,
  Flag,
  Info,
  Lightbulb,
  Loader2,
  MessageCircle,
  RefreshCw,
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
import { cn } from "@/lib/utils";
import { AnalysisView } from "./analysis-markdown";
import { ExperimentRunTrafficConfig } from "./experiment-run-traffic-config";
import { useChatTrigger } from "./chat-trigger-context";
import type { ExperimentRun } from "@/generated/prisma";

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

/* ── Simple inline tab bar ── */

type DrawerTab = "summary" | "analysis" | "traffic";

const TAB_LABELS: { id: DrawerTab; label: string }[] = [
  { id: "summary", label: "Summary" },
  { id: "analysis", label: "Full Analysis" },
  { id: "traffic", label: "Audience & Traffic" },
];

function TabBar({
  active,
  onChange,
}: {
  active: DrawerTab;
  onChange: (t: DrawerTab) => void;
}) {
  return (
    <div className="flex border-b px-4 gap-1">
      {TAB_LABELS.map(({ id, label }) => (
        <button
          key={id}
          onClick={() => onChange(id)}
          className={cn(
            "py-2 px-1 text-xs font-medium border-b-2 -mb-px transition-colors",
            active === id
              ? "border-foreground text-foreground"
              : "border-transparent text-muted-foreground hover:text-foreground"
          )}
        >
          {label}
        </button>
      ))}
    </div>
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

/* ── Tab content panels ── */

function SummaryTab({
  exp,
  onAnalyze,
}: {
  exp: ExperimentRun;
  onAnalyze?: () => void;
}) {
  const guardrailDescs = parseGuardrailDescriptions(exp.guardrailDescriptions);
  const guardrailEvents = parseGuardrailEvents(exp.guardrailEvents);
  const hasDecision = Boolean(exp.decision);

  return (
    <div className="px-4 pb-6 space-y-4">
      {/* No-decision hint */}
      {!hasDecision && onAnalyze && (
        <div className="flex items-center justify-between gap-3 rounded-md border border-dashed px-3 py-2.5 bg-muted/20">
          <div className="flex items-start gap-2 min-w-0">
            <MessageCircle className="size-3.5 mt-0.5 shrink-0 text-muted-foreground" />
            <p className="text-xs text-muted-foreground leading-relaxed">
              暂无决策结论。理解当前数据，并查看结果，可在右侧 chat agent 沟通。
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            className="h-7 text-[11px] px-2.5 shrink-0 gap-1"
            onClick={onAnalyze}
          >
            <Bot className="size-3" />
            Analyze
          </Button>
        </div>
      )}

      {/* Decision callout */}
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
          label="Metric"
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
    </div>
  );
}

function AnalysisTab({ exp, experimentId }: { exp: ExperimentRun; experimentId: string }) {
  const [analysisResult, setAnalysisResult] = useState<string | null>(
    exp.analysisResult ?? null
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const hasAutoTriggered = useRef(false);

  useEffect(() => {
    setAnalysisResult(exp.analysisResult ?? null);
    setError(null);
    setWarning(null);
  }, [exp.id, exp.analysisResult]);

  const runAnalysis = useCallback(async (forceFresh = false) => {
    setLoading(true);
    setError(null);
    setWarning(null);
    try {
      const resp = await fetch(`/api/experiments/${experimentId}/analyze`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ runId: exp.id, forceFresh }),
      });
      const data = await resp.json();
      if (!resp.ok) {
        setError(data.error ?? "Analysis failed");
        return;
      }
      if (data.analysisResult) {
        setAnalysisResult(data.analysisResult);
        if (typeof data.warning === "string" && data.warning.length > 0) {
          setWarning(data.warning);
        }
      } else if (data.error) {
        setError(data.error);
      }
    } catch (err) {
      setError(`Request failed: ${(err as Error).message}`);
    } finally {
      setLoading(false);
    }
  }, [experimentId, exp.id]);

  // Auto-trigger analysis on mount only when no result exists yet
  useEffect(() => {
    if (hasAutoTriggered.current) return;
    if (exp.analysisResult) return;
    hasAutoTriggered.current = true;
    runAnalysis(true);
  }, [runAnalysis, exp.analysisResult]);

  if (loading) {
    return (
      <div className="px-4 pb-6 pt-8 flex flex-col items-center gap-3">
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
        <p className="text-xs text-muted-foreground">
          Running Bayesian analysis…
        </p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="px-4 pb-6 pt-2 space-y-2">
        <p className="text-xs text-destructive">{error}</p>
        <button
          className="text-xs text-blue-600 dark:text-blue-400 underline"
          onClick={() => runAnalysis(true)}
        >
          Retry
        </button>
      </div>
    );
  }

  if (!analysisResult) {
    return (
      <div className="px-4 pb-6 pt-2 space-y-2">
        <Button
          variant="outline"
          size="sm"
          className="h-7 text-[11px] px-2.5 gap-1"
          onClick={() => runAnalysis(true)}
          disabled={loading}
        >
          <RefreshCw className={`size-3 ${loading ? "animate-spin" : ""}`} />
          Refresh Latest Analysis
        </Button>
        <p className="text-xs text-muted-foreground/60">No analysis available yet.</p>
      </div>
    );
  }

  return (
    <div className="px-4 pb-6 overflow-x-auto">
      <div className="mb-2">
        <Button
          variant="outline"
          size="sm"
          className="h-7 text-[11px] px-2.5 gap-1"
          onClick={() => runAnalysis(true)}
          disabled={loading}
        >
          <RefreshCw className={`size-3 ${loading ? "animate-spin" : ""}`} />
          Refresh Latest Analysis
        </Button>
      </div>
      {warning && (
        <p className="mb-2 text-xs text-amber-600 dark:text-amber-400">{warning}</p>
      )}
      <div className="rounded border bg-muted/20 px-3 py-2.5">
        <AnalysisView content={analysisResult} />
      </div>
    </div>
  );
}

function TrafficTab({
  exp,
  experimentId,
}: {
  exp: ExperimentRun;
  experimentId: string;
}) {
  return (
    <div className="px-4 pb-6 space-y-4">
      <div>
        <SectionLabel
          icon={<Filter className="size-3" />}
          label="Audience & Traffic"
        />
        <ExperimentRunTrafficConfig experimentRun={exp} experimentId={experimentId} />
      </div>

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
    </div>
  );
}

/* ── Main export: compact table + sheet drawer ── */

export function ExperimentRunTable({
  experimentRuns,
  experimentId,
  isSequential,
}: {
  experimentRuns: ExperimentRun[];
  experimentId: string;
  isSequential: boolean;
}) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<DrawerTab>("summary");
  const triggerChat = useChatTrigger();
  const selected = selectedId ? (experimentRuns.find((e) => e.id === selectedId) ?? null) : null;
  const selectedIndex = selected
    ? experimentRuns.findIndex((e) => e.id === selected.id)
    : -1;

  function openDetail(exp: ExperimentRun) {
    setSelectedId(exp.id);
    setActiveTab("summary");
  }

  function handleAnalyze(exp: ExperimentRun) {
    const message = `请分析实验 "${exp.slug}" 的当前数据，并给出 deciding 结论（CONTINUE / PAUSE / ROLLBACK_CANDIDATE / INCONCLUSIVE）。请说明理由。`;
    triggerChat?.(message);
    setSelectedId(null);
  }

  return (
    <>
      {experimentRuns.length === 0 ? (
        <div className="rounded-md border border-dashed p-3 text-center">
          <p className="text-xs text-muted-foreground/60">No experiment runs yet</p>
          <p className="text-[10px] text-muted-foreground/40 mt-1">
            Experiment runs will appear here once the agent sets them up.
          </p>
        </div>
      ) : (
        /* Horizontal scroll wrapper */
        <div className="rounded-md border overflow-x-auto">
          <table className="min-w-full text-xs whitespace-nowrap">
            <thead>
              <tr className="border-b bg-muted/40 text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
                <th className="px-3 py-2 text-left w-8">#</th>
                <th className="px-3 py-2 text-left">Experiment Run</th>
                <th className="px-3 py-2 text-left">Metrics</th>
                <th className="px-3 py-2 text-left">Status</th>
                <th className="px-3 py-2 text-left">Decision</th>
              </tr>
            </thead>
            <tbody>
              {experimentRuns.map((exp, idx) => (
                <tr
                  key={exp.id}
                  className="border-b last:border-0 hover:bg-muted/20 transition-colors"
                >
                  {/* # */}
                  <td className="px-3 py-2.5 text-muted-foreground tabular-nums align-top">
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

                  {/* Experiment run name + method */}
                  <td className="px-3 py-2.5 align-top">
                    <button
                      className="font-mono font-medium text-blue-600 dark:text-blue-400 underline underline-offset-2 hover:text-blue-800 dark:hover:text-blue-200 transition-colors text-left whitespace-normal"
                      onClick={() => openDetail(exp)}
                    >
                      {exp.slug}
                    </button>
                    {exp.method && (
                      <div className="mt-1">
                        <MethodBadge method={exp.method} />
                      </div>
                    )}
                  </td>

                  {/* Primary Metric */}
                  <td className="px-3 py-2.5 align-top">
                    {exp.primaryMetricEvent ? (
                      <span className="font-mono text-[11px]">{exp.primaryMetricEvent}</span>
                    ) : (
                      <span className="text-muted-foreground/40">—</span>
                    )}
                    {(() => {
                      const gEvents = parseGuardrailEvents(exp.guardrailEvents);
                      return gEvents.length > 0 ? (
                        <div className="mt-0.5 flex items-center gap-1 text-[10px] text-muted-foreground">
                          <ShieldCheck className="size-3 shrink-0" />
                          <span className="font-mono">{gEvents.join(", ")}</span>
                        </div>
                      ) : null;
                    })()}
                  </td>

                  {/* Status */}
                  <td className="px-3 py-2.5 align-top">
                    <StatusBadge status={exp.status} />
                  </td>

                  {/* Decision */}
                  <td className="px-3 py-2.5 align-top">
                    <DecisionBadge decision={exp.decision} />
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
          if (!open) setSelectedId(null);
        }}
      >
        <SheetContent
          side="right"
          hideOverlay
          className="w-[56rem] min-w-[68vw] sm:max-w-[56rem] p-0 flex flex-col gap-0"
        >
          {selected && (
            <>
              {/* Header */}
              <SheetHeader className="pl-4 pr-12 pt-4 pb-3 border-b shrink-0">
                <div className="flex items-center gap-2 flex-wrap">
                  {isSequential && selectedIndex >= 0 && (
                    <Badge variant="outline" className="text-[10px] px-1.5 py-0">
                      Phase {selectedIndex + 1}
                    </Badge>
                  )}
                  <SheetTitle className="font-mono text-sm">
                    {selected.slug}
                  </SheetTitle>
                  <div className="flex items-center gap-1.5 ml-auto flex-wrap">
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

              {/* Tab bar */}
              <TabBar active={activeTab} onChange={setActiveTab} />

              {/* Tab content */}
              <div className="flex-1 overflow-y-auto pt-3">
                {activeTab === "summary" && (
                  <SummaryTab
                    exp={selected}
                    onAnalyze={
                      triggerChat ? () => handleAnalyze(selected) : undefined
                    }
                  />
                )}
                {activeTab === "analysis" && <AnalysisTab exp={selected} experimentId={experimentId} />}
                {activeTab === "traffic" && (
                  <TrafficTab exp={selected} experimentId={experimentId} />
                )}
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>
    </>
  );
}
