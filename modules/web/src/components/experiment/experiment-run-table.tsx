"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import {
  Beaker,
  Bot,
  Calendar,
  Filter,
  Flag,
  Info,
  Loader2,
  MessageCircle,
  RefreshCw,
  ShieldCheck,
  Target,
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
    "bg-red-100 border-red-300 dark:bg-red-900/40 dark:border-red-700",
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
      : status === "collecting"
        ? "bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300"
        : status === "analyzing"
          ? "bg-purple-100 text-purple-800 dark:bg-purple-900/40 dark:text-purple-300"
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

type DrawerTab = "summary" | "traffic";

const TAB_LABELS: { id: DrawerTab; label: string }[] = [
  { id: "summary", label: "Analyze & Decision" },
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
  analysisPanel,
}: {
  exp: ExperimentRun;
  onAnalyze?: () => void;
  analysisPanel?: React.ReactNode;
}) {
  const hasDecision = Boolean(exp.decision);

  return (
    <div className="px-4 pb-6 space-y-4">
      {/* Chat-first decision helper */}
      {onAnalyze && (
        <div className="flex items-center justify-between gap-3 rounded-md border border-dashed px-3 py-2.5 bg-muted/20">
          <div className="flex items-start gap-2 min-w-0">
            <MessageCircle className="size-3.5 mt-0.5 shrink-0 text-muted-foreground" />
            <p className="text-xs text-muted-foreground leading-relaxed">
              {hasDecision
                ? "当前已有决策。点击后会让 chat 结合当前分析结果，给出复核结论与建议。"
                : "点击后会让 chat 基于当前分析数据，产出可执行的决策解释（继续/暂停/回滚候选/不确定）。"}
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            className="h-7 text-[11px] px-2.5 shrink-0 gap-1"
            onClick={onAnalyze}
          >
            <Bot className="size-3" />
            Analyze & Decision in Chat
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

      {analysisPanel && (
        <div className="pt-1">
          <SectionLabel icon={<Beaker className="size-3" />} label="Full Analysis" />
          {analysisPanel}
        </div>
      )}
    </div>
  );
}

const AUTO_REFRESH_INTERVAL = 15; // seconds, must match experiment-detail-layout.tsx

function RefreshAnalysisButton({
  loading,
  onConfirm,
}: {
  loading: boolean;
  onConfirm: () => void;
}) {
  const [confirming, setConfirming] = useState(false);

  if (confirming) {
    return (
      <div className="rounded-md border border-dashed px-3 py-2.5 space-y-2 bg-muted/20">
        <p className="text-xs font-medium">Analyze Latest Data?</p>
        <p className="text-xs text-muted-foreground">
          This will pull fresh metrics and recompute the latest analysis.
        </p>
        <div className="flex gap-2 pt-1">
          <Button
            size="sm"
            className="h-7 text-[11px] px-2.5"
            onClick={() => { setConfirming(false); onConfirm(); }}
          >
            Start Analyze
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="h-7 text-[11px] px-2.5"
            onClick={() => setConfirming(false)}
          >
            Cancel
          </Button>
        </div>
      </div>
    );
  }

  return (
    <Button
      variant="outline"
      size="sm"
      className="h-7 text-[11px] px-2.5 gap-1"
      onClick={() => setConfirming(true)}
      disabled={loading}
    >
      <RefreshCw className={`size-3 ${loading ? "animate-spin" : ""}`} />
      Analyze Latest Data
    </Button>
  );
}

function AnalysisTab({
  exp,
  experimentId,
  flagKey,
  featbitEnvId,
  embedded = false,
}: {
  exp: ExperimentRun;
  experimentId: string;
  flagKey: string | null;
  featbitEnvId: string | null;
  embedded?: boolean;
}) {
  // Pre-check what the backend requires. Rendering a config gap here beats
  // auto-firing a POST that always 400s before the experiment is set up.
  // If inputData was already pasted in expert setup, we can analyze without
  // live flag wiring — only the metric event is strictly needed.
  const hasStoredInputData = !!exp.inputData;
  const missingFields: string[] = [];
  if (!exp.primaryMetricEvent) missingFields.push("primary metric event");
  if (!hasStoredInputData) {
    if (!flagKey) missingFields.push("flag key");
    if (!featbitEnvId) missingFields.push("FeatBit env ID");
  }

  const [analysisResult, setAnalysisResult] = useState<string | null>(
    exp.analysisResult ?? null
  );
  const [loading, setLoading] = useState(false);
  const [isFreshRefresh, setIsFreshRefresh] = useState(false);
  const [noData, setNoData] = useState(false);
  const [countdown, setCountdown] = useState(AUTO_REFRESH_INTERVAL);
  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const hasAutoTriggered = useRef(false);

  useEffect(() => {
    setAnalysisResult(exp.analysisResult ?? null);
    setError(null);
    setWarning(null);
  }, [exp.id, exp.analysisResult]);

  // Countdown ticker shown while loading a fresh refresh
  useEffect(() => {
    if (!loading || !isFreshRefresh) return;
    setCountdown(AUTO_REFRESH_INTERVAL);
    const id = setInterval(() => {
      setCountdown((c) => {
        if (c <= 1) return AUTO_REFRESH_INTERVAL;
        return c - 1;
      });
    }, 1000);
    return () => clearInterval(id);
  }, [loading, isFreshRefresh]);

  const runAnalysis = useCallback(async (forceFresh = false) => {
    setLoading(true);
    setIsFreshRefresh(forceFresh);
    setError(null);
    setWarning(null);
    setNoData(false);
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
      // "no_data" is an expected empty state, not an error.
      if (data.status === "no_data") {
        setNoData(true);
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

  // Auto-trigger analysis on mount only when no result exists yet AND the
  // experiment has the fields the analyze endpoint requires. Otherwise the
  // POST will just 400 — render a setup card instead.
  useEffect(() => {
    if (hasAutoTriggered.current) return;
    if (exp.analysisResult) return;
    if (missingFields.length > 0) return;
    hasAutoTriggered.current = true;
    runAnalysis(true);
  }, [runAnalysis, exp.analysisResult, missingFields.length]);

  if (missingFields.length > 0 && !analysisResult) {
    return (
      <div className={cn("pb-6 pt-4 space-y-2", embedded ? "" : "px-4")}>
        <p className="text-xs font-medium">Analysis not ready</p>
        <p className="text-xs text-muted-foreground">
          Set up {missingFields.join(", ")} before running analysis.
        </p>
        <p className="text-[11px] text-muted-foreground/70">
          Ask the agent in the chat panel to configure these, or edit the
          experiment in the <code>Exposing</code> stage.
        </p>
      </div>
    );
  }

  if (loading) {
    return (
      <div className={cn("pb-6 pt-8 flex flex-col items-center gap-3", embedded ? "" : "px-4")}>
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
        <p className="text-xs text-muted-foreground">Running Bayesian analysis…</p>
        {isFreshRefresh && (
          <>
            <p className="text-xs text-muted-foreground/70 text-center max-w-xs">
              Rolling up the latest data — this may take a moment. You can
              navigate away; results will appear automatically.
            </p>
            <p className="text-xs text-muted-foreground/50">
              Next auto-refresh in {countdown}s
            </p>
          </>
        )}
      </div>
    );
  }

  if (error) {
    return (
      <div className={cn("pb-6 pt-2 space-y-2", embedded ? "" : "px-4")}>
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

  if (noData) {
    return (
      <div className={cn("pb-6 pt-4 space-y-2", embedded ? "" : "px-4")}>
        <p className="text-xs font-medium">Waiting for data</p>
        <p className="text-xs text-muted-foreground">
          No events have arrived yet for this experiment. Once your instrumentation
          starts sending <code>flag_evaluation</code> and metric events for
          <code> env={featbitEnvId ?? "…"}</code> / <code>flag={flagKey ?? "…"}</code>,
          results will show up here automatically.
        </p>
        <button
          className="text-xs text-blue-600 dark:text-blue-400 underline"
          onClick={() => runAnalysis(true)}
        >
          Check again
        </button>
      </div>
    );
  }

  if (!analysisResult) {
    return (
      <div className={cn("pb-6 pt-2 space-y-2", embedded ? "" : "px-4")}>
        <RefreshAnalysisButton loading={loading} onConfirm={() => runAnalysis(true)} />
        <p className="text-xs text-muted-foreground/60">No analysis available yet.</p>
      </div>
    );
  }

  return (
    <div className={cn("pb-6 overflow-x-auto", embedded ? "" : "px-4")}>
      <div className="mb-2">
        <RefreshAnalysisButton loading={loading} onConfirm={() => runAnalysis(true)} />
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
  flagKey,
  featbitEnvId,
  isSequential,
}: {
  experimentRuns: ExperimentRun[];
  experimentId: string;
  flagKey: string | null;
  featbitEnvId: string | null;
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
    if (!triggerChat) return;

    const message = `请基于当前实验 run "${exp.slug}" 的现有分析结果，给出 deciding 结论（CONTINUE / PAUSE / ROLLBACK_CANDIDATE / INCONCLUSIVE），并说明：1) 主指标信号 2) guardrail 风险 3) 下一步行动。`;
    triggerChat(message);
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
                    analysisPanel={
                      <AnalysisTab
                        exp={selected}
                        experimentId={experimentId}
                        flagKey={flagKey}
                        featbitEnvId={featbitEnvId}
                        embedded
                      />
                    }
                  />
                )}
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
