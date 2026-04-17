import { getStage } from "@/lib/stages";
import { EditDecisionStateDialog } from "./decision-state-edit";
import { MetricEditDialog } from "./metric-edit";
import { Badge } from "@/components/ui/badge";
import {
  Lightbulb,
  FlaskConical,
  BarChart3,
  Flag,
  Filter,
  BookOpen,
  Beaker,
  Calendar,
  Info,
  Code,
  Activity,
  ExternalLink,
  ShieldAlert,
  ShieldCheck,
  Target,
} from "lucide-react";
import type { Experiment, ExperimentRun } from "@/generated/prisma";
import { FlagIntegrationHeader } from "./flag-config";
import { ExperimentRunTrafficConfig } from "./experiment-run-traffic-config";
import { ExperimentRunTable } from "./experiment-run-table";
import { TrafficPoolView } from "./traffic-pool-view";
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from "@/components/ui/collapsible";

type ExperimentWithRelations = Experiment & {
  experimentRuns: ExperimentRun[];
};

/* ── Shared: sort experiment runs by observationStart & detect sequential design ── */
function sortAndDetectSequential(experimentRuns: ExperimentRun[]) {
  const sorted = [...experimentRuns].sort((a, b) => {
    if (!a.observationStart) return 1;
    if (!b.observationStart) return -1;
    return new Date(a.observationStart).getTime() - new Date(b.observationStart).getTime();
  });
  const isSequential =
    sorted.length >= 2 &&
    !!sorted[0].observationEnd &&
    !!sorted[1].observationStart &&
    new Date(sorted[0].observationEnd) <= new Date(sorted[1].observationStart);
  return { sorted, isSequential };
}

/* ── Per-stage field definitions ── */
const STAGE_CONFIG: Record<
  string,
  { icon: React.ReactNode; fields: { key: keyof Experiment; label: string }[] }
> = {
  hypothesis: {
    icon: <Lightbulb className="size-3.5" />,
    fields: [
      { key: "goal", label: "Goal" },
      { key: "intent", label: "Intent" },
      { key: "hypothesis", label: "Hypothesis" },
      { key: "change", label: "Change" },
      { key: "constraints", label: "Constraints" },
    ],
  },
  implementing: {
    icon: <FlaskConical className="size-3.5" />,
    fields: [],
  },
  measuring: {
    icon: <BarChart3 className="size-3.5" />,
    fields: [], // measuring has its own custom layout
  },
  learning: {
    icon: <BookOpen className="size-3.5" />,
    fields: [
      { key: "hypothesis", label: "Hypothesis" },
      { key: "lastLearning", label: "Key Learning" },
    ],
  },
};

/* ── Main panel ── */
export function StageContentPanel({
  experiment,
  activeTab,
}: {
  experiment: ExperimentWithRelations;
  activeTab: string;
}) {
  const stage = getStage(activeTab);

  return (
    <div className="h-full overflow-y-auto p-5 space-y-5">
      {/* Stage header */}
      <div className="space-y-1">
        <div className="flex items-center gap-2">
          <Badge className={`text-[10px] ${stage.color}`}>{stage.cf}</Badge>
          <span className="text-sm font-semibold">{stage.label}</span>
        </div>
        <p className="text-xs text-muted-foreground">
          {stage.description}
        </p>
      </div>

      {/* Stage-specific content */}
      {activeTab === "measuring" ? (
        <MeasuringContent experiment={experiment} />
      ) : activeTab === "implementing" ? (
        <FlagAndExperimentSection experiment={experiment} />
      ) : activeTab === "learning" ? (
        <>
          <FieldsSection experiment={experiment} stageKey={activeTab} />
          <LearningSection experimentRuns={experiment.experimentRuns} />
        </>
      ) : activeTab === "hypothesis" ? (
        <>
          <FieldsSection experiment={experiment} stageKey={activeTab} />
          <ConflictAnalysisSection conflictAnalysis={experiment.conflictAnalysis} />
        </>
      ) : (
        <FieldsSection experiment={experiment} stageKey={activeTab} />
      )}
    </div>
  );
}

/* ── Shared multi-line metric renderer ── */
function MetricLines({ value }: { value: string | null | undefined }) {
  if (!value) return <p className="text-xs italic text-muted-foreground/50">Not set</p>;

  try {
    const parsed = JSON.parse(value);

    // JSON array → guardrails list [{name, description}]
    if (Array.isArray(parsed) && parsed.length > 0) {
      return (
        <ul className="space-y-1">
          {parsed.map((g: { name?: string; event?: string; description?: string }, i: number) => (
            <li key={i} className="text-xs">
              <span className="font-mono font-medium">{g.name ?? g.event ?? ""}</span>
              {g.description && (
                <span className="text-muted-foreground"> — {g.description}</span>
              )}
            </li>
          ))}
        </ul>
      );
    }

    // JSON object → primary metric {name, event, metricType, metricAgg, description}
    if (parsed && typeof parsed === "object" && (parsed.event || parsed.name)) {
      const technicalLine = [
        parsed.event,
        parsed.metricType,
        parsed.metricAgg ? `counted ${parsed.metricAgg}` : null,
      ].filter(Boolean).join(" · ");
      return (
        <div className="space-y-0.5">
          {parsed.name && <p className="text-xs leading-relaxed font-medium">{parsed.name}</p>}
          {parsed.event && (
            <p className="text-xs font-mono text-muted-foreground">{technicalLine}</p>
          )}
          {parsed.description && (
            <p className="text-[11px] text-muted-foreground/70 leading-relaxed">{parsed.description}</p>
          )}
        </div>
      );
    }
  } catch { /* plain text — fall through */ }

  const lines = value.split("\n").filter(Boolean);
  if (lines.length === 1) return <p className="text-xs leading-relaxed">{lines[0]}</p>;
  return (
    <ul className="space-y-0.5">
      {lines.map((line, i) => (
        <li key={i} className="text-xs leading-relaxed">{line}</li>
      ))}
    </ul>
  );
}

/* ── Generic fields renderer ── */
function FieldsSection({
  experiment,
  stageKey,
}: {
  experiment: ExperimentWithRelations;
  stageKey: string;
}) {
  const config = STAGE_CONFIG[stageKey];
  if (!config || config.fields.length === 0) return null;

  const editableKeys = config.fields.map((f) => f.key) as Array<keyof Experiment>;

  return (
    <section className="space-y-2">
      <div className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
        {config.icon}
        <span>Details</span>
        <EditDecisionStateDialog experiment={experiment} fields={editableKeys} />
      </div>
      <div className="space-y-2">
        {config.fields.map(({ key, label }) => {
          const value = (experiment[key] as string) ?? "";
          return (
            <div key={key}>
              <span className="text-[10px] font-medium text-muted-foreground uppercase">
                {label}
              </span>
              {key === "guardrails" ? (
                <MetricLines value={value} />
              ) : (
                <p className="text-xs leading-relaxed whitespace-pre-line">
                  {value || (
                    <span className="italic text-muted-foreground/50">
                      Not set
                    </span>
                  )}
                </p>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}

/* ── Combined flag + metric integration + experiment runs (implementing) ── */
function FlagAndExperimentSection({
  experiment,
}: {
  experiment: ExperimentWithRelations;
}) {
  const experimentRuns = experiment.experimentRuns;
  const { sorted, isSequential } = sortAndDetectSequential(experimentRuns);

  return (
    <>
      {/* ─── Section 1: Feature Flag Integration ─── */}
      <FlagIntegrationHeader experiment={experiment} experimentRuns={sorted} />

      {/* ─── Section 2: Metrics Integration ─── */}
      <MetricsIntegrationSection experiment={experiment} experimentRuns={sorted} />

      {/* ─── Section 3: Experiment Runs — Traffic & Schedule ─── */}
      <section className="space-y-3">
        <div className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
          <FlaskConical className="size-3.5" />
          <span>Experiment Runs</span>
          {experimentRuns.length > 0 && (
            <span className="ml-auto text-[10px] tabular-nums">
              {experimentRuns.length} run{experimentRuns.length > 1 ? "s" : ""}
            </span>
          )}
        </div>

        {/* Traffic pool overview */}
        {experimentRuns.length > 0 && (
          <TrafficPoolView experimentRuns={sorted} isSequential={isSequential} />
        )}

        {/* Experiment run cards */}
        <div className="space-y-3">
          {sorted.map((exp, idx) => (
            <ExperimentRunCard
              key={exp.id}
              run={exp}
              idx={idx}
              isSequential={isSequential}
              experimentId={experiment.id}
              flagKey={experiment.flagKey}
            />
          ))}
        </div>
      </section>
    </>
  );
}

/* ── Metrics integration section ── */
function MetricsIntegrationSection({
  experiment,
  experimentRuns,
}: {
  experiment: ExperimentWithRelations;
  experimentRuns: ExperimentRun[];
}) {
  // Collect metric info from experiment + runs
  const primaryMetricEvent = experimentRuns.find(r => r.primaryMetricEvent)?.primaryMetricEvent;
  const metricDescription = experimentRuns.find(r => r.metricDescription)?.metricDescription;
  const guardrailEvents = experimentRuns.find(r => r.guardrailEvents)?.guardrailEvents;

  return (
    <section className="space-y-3">
      <div className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
        <Activity className="size-3.5" />
        <span>Metrics Integration</span>
        <MetricEditDialog experiment={experiment} />
      </div>

      <div className="rounded-md border bg-muted/10 px-3 py-3 space-y-3">
        {/* Primary metric */}
        <div>
          <span className="text-[10px] font-medium text-muted-foreground uppercase">Primary Metric</span>
          <MetricLines value={experiment.primaryMetric} />
        </div>

        {/* Metric event name */}
        {primaryMetricEvent && (
          <div className="flex items-center gap-3 flex-wrap">
            <span className="text-[10px] font-medium text-muted-foreground uppercase">Event Name</span>
            <Badge variant="outline" className="font-mono text-xs px-2 py-0.5">
              <Code className="size-3 mr-1" />
              {primaryMetricEvent}
            </Badge>
          </div>
        )}

        {/* Metric description */}
        {metricDescription && (
          <div>
            <span className="text-[10px] font-medium text-muted-foreground uppercase">Description</span>
            <p className="text-xs leading-relaxed text-muted-foreground">{metricDescription}</p>
          </div>
        )}

        {/* Guardrails */}
        {(experiment.guardrails || guardrailEvents) && (
          <div>
            <span className="text-[10px] font-medium text-muted-foreground uppercase">Guardrails</span>
            {experiment.guardrails && <MetricLines value={experiment.guardrails} />}
            {guardrailEvents && (() => {
              let events: string[] = [];
              try { const v = JSON.parse(guardrailEvents); events = Array.isArray(v) ? v : []; } catch { /* skip */ }
              return events.length > 0 ? (
                <div className="flex items-center gap-2 flex-wrap mt-1">
                  <span className="text-[10px] font-medium text-muted-foreground uppercase">Event Names</span>
                  {events.map((evt) => (
                    <Badge key={evt} variant="outline" className="font-mono text-xs px-2 py-0.5">
                      <Code className="size-3 mr-1" />
                      {evt}
                    </Badge>
                  ))}
                </div>
              ) : null;
            })()}
          </div>
        )}
      </div>
    </section>
  );
}

/* ── Single experiment run card ── */
function ExperimentRunCard({
  run,
  idx,
  isSequential,
  experimentId,
  flagKey,
}: {
  run: ExperimentRun;
  idx: number;
  isSequential: boolean;
  experimentId: string;
  flagKey: string | null;
}) {
  return (
    <div className="rounded-md border space-y-0">
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2 bg-muted/30 border-b">
        {isSequential ? (
          <Badge variant="outline" className="text-[10px] px-1.5 py-0">
            Phase {idx + 1}
          </Badge>
        ) : (
          <span className="text-xs font-medium text-muted-foreground">
            #{idx + 1}
          </span>
        )}
        <span className="text-xs font-mono font-medium">{run.slug}</span>
        <div className="ml-auto flex items-center gap-1.5">
          {run.method && <MethodBadge method={run.method} />}
          <StatusBadge status={run.status} />
        </div>
      </div>

      <div className="px-3 py-2 space-y-3">
        {/* Variants */}
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
          {run.controlVariant && (
            <span className="flex items-center gap-1">
              <span className="inline-block size-2 rounded-full bg-emerald-500" />
              <span className="text-muted-foreground">Control:</span>{" "}
              <span className="font-mono font-medium">{run.controlVariant}</span>
            </span>
          )}
          {run.treatmentVariant && (
            <span className="flex items-center gap-1">
              <span className="inline-block size-2 rounded-full bg-violet-500" />
              <span className="text-muted-foreground">Treatment:</span>{" "}
              <span className="font-mono font-medium">{run.treatmentVariant}</span>
            </span>
          )}
        </div>

        {/* Audience & Traffic — merged with traffic allocation */}
        <div>
          <SectionLabel icon={<Filter className="size-3" />} label="Audience &amp; Traffic" />
          <ExperimentRunTrafficConfig experimentRun={run} experimentId={experimentId} />
        </div>

        {/* Schedule: Observation window + min sample */}
        {(run.observationStart || run.minimumSample) && (
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
            {run.minimumSample && (
              <span>
                Min sample: <span className="tabular-nums font-medium text-foreground">{run.minimumSample}</span>/variant
              </span>
            )}
            {run.observationStart && run.observationEnd && (
              <span>
                <Calendar className="inline size-3 mr-0.5" />
                {fmtDate(run.observationStart)} → {fmtDate(run.observationEnd)}
              </span>
            )}
          </div>
        )}

        {/* Method reason — collapsible */}
        {run.methodReason && (
          <Collapsible>
            <CollapsibleTrigger className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider hover:text-foreground">
              <Info className="size-3" />
              Why This Method
            </CollapsibleTrigger>
            <CollapsibleContent className="mt-1">
              <p className="text-xs leading-relaxed text-muted-foreground pl-5">
                {run.methodReason}
              </p>
            </CollapsibleContent>
          </Collapsible>
        )}
      </div>
    </div>
  );
}

/* ── Measuring: metrics overview + rich experiment run cards ── */
function MeasuringContent({
  experiment,
}: {
  experiment: ExperimentWithRelations;
}) {
  const { sorted, isSequential } = sortAndDetectSequential(experiment.experimentRuns);

  return (
    <>
      {/* North star metric + guardrails */}
      <section className="space-y-2">
        <div className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
          <BarChart3 className="size-3.5" />
          <span>Experiment Metrics</span>
          <MetricEditDialog experiment={experiment} />
        </div>
        <div className="space-y-2">
          <div>
            <div className="flex items-center gap-1 text-[10px] font-medium text-muted-foreground uppercase">
              <Target className="size-3" />
              <span>Primary Metric (North Star)</span>
            </div>
            <MetricLines value={experiment.primaryMetric} />
          </div>
          <div>
            <div className="flex items-center gap-1 text-[10px] font-medium text-muted-foreground uppercase">
              <ShieldCheck className="size-3" />
              <span>Guardrails</span>
            </div>
            <MetricLines value={experiment.guardrails} />
          </div>
        </div>
      </section>

      {/* Experiment run cards */}
      <section className="space-y-2">
        <div className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
          <FlaskConical className="size-3.5" />
          <span>Experiment Runs</span>
          <span className="ml-auto text-[10px] tabular-nums">
            {sorted.length}
          </span>
        </div>
        {sorted.length === 0 ? (
          <div className="rounded-md border border-dashed p-3 text-center">
            <p className="text-xs text-muted-foreground/60">
              No experiment runs yet
            </p>
            <p className="text-[10px] text-muted-foreground/40 mt-1">
              Experiment runs will appear here once the agent sets them up.
            </p>
          </div>
        ) : (
          <ExperimentRunTable
            experimentRuns={sorted}
            experimentId={experiment.id}
            flagKey={experiment.flagKey}
            featbitEnvId={experiment.featbitEnvId}
            isSequential={isSequential}
          />
        )}
      </section>
    </>
  );
}

/* ── Experiment run learnings (learning tab) ── */
function LearningSection({
  experimentRuns,
}: {
  experimentRuns: ExperimentRun[];
}) {
  const { sorted, isSequential } = sortAndDetectSequential(experimentRuns);
  const withLearnings = sorted.filter(
    (e) =>
      e.whatChanged ||
      e.whatHappened ||
      e.confirmedOrRefuted ||
      e.nextHypothesis
  );

  return (
    <section className="space-y-2">
      <div className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
        <BookOpen className="size-3.5" />
        <span>Experiment Run Learnings</span>
      </div>
      {withLearnings.length === 0 ? (
        <div className="rounded-md border border-dashed p-3 text-center">
          <p className="text-xs text-muted-foreground/60">
            No learnings captured yet.
          </p>
          <p className="text-[10px] text-muted-foreground/40 mt-1">
            Learnings will be recorded after experiment runs are analyzed.
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {withLearnings.map((exp) => {
            const phaseIdx = sorted.indexOf(exp);
            return (
            <div key={exp.id} className="rounded border px-2 py-2 space-y-1">
              <div className="flex items-center gap-1.5">
                {isSequential ? (
                  <Badge variant="outline" className="text-[10px] px-1.5 py-0">
                    Phase {phaseIdx + 1}
                  </Badge>
                ) : (
                  <span className="text-xs font-medium text-muted-foreground">
                    #{phaseIdx + 1}
                  </span>
                )}
                <span className="text-xs font-mono font-medium">{exp.slug}</span>
              </div>
              {exp.whatChanged && (
                <div>
                  <span className="text-[10px] font-medium text-muted-foreground uppercase">
                    What Changed
                  </span>
                  <p className="text-xs leading-relaxed">{exp.whatChanged}</p>
                </div>
              )}
              {exp.whatHappened && (
                <div>
                  <span className="text-[10px] font-medium text-muted-foreground uppercase">
                    What Happened
                  </span>
                  <p className="text-xs leading-relaxed">{exp.whatHappened}</p>
                </div>
              )}
              {exp.confirmedOrRefuted && (
                <div>
                  <span className="text-[10px] font-medium text-muted-foreground uppercase">
                    Confirmed or Refuted
                  </span>
                  <p className="text-xs leading-relaxed">
                    {exp.confirmedOrRefuted}
                  </p>
                </div>
              )}
              {exp.whyItHappened && (
                <div>
                  <span className="text-[10px] font-medium text-muted-foreground uppercase">
                    Why It Happened
                  </span>
                  <p className="text-xs leading-relaxed">
                    {exp.whyItHappened}
                  </p>
                </div>
              )}
              {exp.nextHypothesis && (
                <div>
                  <span className="text-[10px] font-medium text-muted-foreground uppercase">
                    Next Hypothesis
                  </span>
                  <p className="text-xs leading-relaxed">
                    {exp.nextHypothesis}
                  </p>
                </div>
              )}
            </div>
          );
          })}
        </div>
      )}
    </section>
  );
}

/* ── Conflict analysis section (hypothesis stage) ── */
function ConflictAnalysisSection({
  conflictAnalysis,
}: {
  conflictAnalysis: string | null | undefined;
}) {
  if (!conflictAnalysis) return null;

  const hasConflict =
    conflictAnalysis.includes("⚠️") ||
    conflictAnalysis.toLowerCase().includes("conflict detected") ||
    conflictAnalysis.toLowerCase().includes("potential conflict");

  return (
    <section className="space-y-2">
      <div className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
        {hasConflict ? (
          <ShieldAlert className="size-3.5 text-amber-500" />
        ) : (
          <ShieldCheck className="size-3.5 text-emerald-500" />
        )}
        <span>Experiment Conflict Check</span>
      </div>
      <div
        className={`rounded-md border px-3 py-3 text-xs leading-relaxed whitespace-pre-line ${
          hasConflict
            ? "border-amber-200 bg-amber-50/50 dark:border-amber-800 dark:bg-amber-950/20"
            : "border-emerald-200 bg-emerald-50/50 dark:border-emerald-800 dark:bg-emerald-950/20"
        }`}
      >
        {conflictAnalysis}
      </div>
    </section>
  );
}

/* ═══════════════════════════════════════════════════════════
   Shared primitives
   ═══════════════════════════════════════════════════════════ */

function SectionLabel({ icon, label }: { icon: React.ReactNode; label: string }) {
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

const DECISION_COLORS: Record<string, string> = {
  CONTINUE: "bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300",
  PAUSE: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/40 dark:text-yellow-300",
  ROLLBACK_CANDIDATE: "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300",
  INCONCLUSIVE: "bg-gray-100 text-gray-700 dark:bg-gray-800/40 dark:text-gray-300",
};

function DecisionBadge({ decision }: { decision: string | null }) {
  if (!decision) {
    return (
      <Badge variant="outline" className="text-[10px]">
        Pending
      </Badge>
    );
  }
  const color = DECISION_COLORS[decision] ?? "";
  return (
    <Badge className={`text-[10px] px-1.5 py-0 ${color}`}>
      {decision}
    </Badge>
  );
}

function parseGuardrailDescriptions(raw: string | null | undefined): Record<string, string> {
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
