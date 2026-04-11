import { getStage } from "@/lib/stages";
import { Badge } from "@/components/ui/badge";
import {
  Target,
  Lightbulb,
  FlaskConical,
  BarChart3,
  Flag,
  Filter,
  BookOpen,
  Beaker,
  Calendar,
  Info,
} from "lucide-react";
import type { Project, Experiment } from "@/generated/prisma/client";
import { FlagConfig } from "./flag-config";
import { ExperimentTrafficConfig } from "./experiment-traffic-config";
import { ExperimentTable } from "./experiment-table";
import { TrafficPoolView } from "./traffic-pool-view";

type ProjectWithRelations = Project & {
  experiments: Experiment[];
};

/* ── Shared: sort experiments by observationStart & detect sequential design ── */
function sortAndDetectSequential(experiments: Experiment[]) {
  const sorted = [...experiments].sort((a, b) => {
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
  { icon: React.ReactNode; fields: { key: keyof Project; label: string }[] }
> = {
  intent: {
    icon: <Target className="size-3.5" />,
    fields: [
      { key: "goal", label: "Goal" },
      { key: "intent", label: "Intent" },
    ],
  },
  hypothesis: {
    icon: <Lightbulb className="size-3.5" />,
    fields: [
      { key: "goal", label: "Goal" },
      { key: "hypothesis", label: "Hypothesis" },
      { key: "change", label: "Change" },
    ],
  },
  implementing: {
    icon: <FlaskConical className="size-3.5" />,
    fields: [
      { key: "change", label: "Change" },
      { key: "primaryMetric", label: "Primary Metric" },
      { key: "variants", label: "Variants" },
      { key: "constraints", label: "Constraints" },
    ],
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
  project,
  activeTab,
}: {
  project: ProjectWithRelations;
  activeTab: string;
}) {
  const stage = getStage(activeTab);

  return (
    <div className="h-full overflow-y-auto p-5 space-y-5">
      {/* Stage header */}
      <div className="flex items-center gap-2">
        <Badge className={`text-[10px] ${stage.color}`}>{stage.cf}</Badge>
        <span className="text-sm font-semibold">{stage.label}</span>
        <span className="text-xs text-muted-foreground ml-auto">
          {stage.description}
        </span>
      </div>

      {/* Stage-specific content */}
      {activeTab === "measuring" ? (
        <MeasuringContent project={project} />
      ) : activeTab === "implementing" ? (
        <>
          <FieldsSection project={project} stageKey={activeTab} />
          <FlagAndExperimentSection project={project} />
        </>
      ) : activeTab === "learning" ? (
        <>
          <FieldsSection project={project} stageKey={activeTab} />
          <LearningSection experiments={project.experiments} />
        </>
      ) : (
        <FieldsSection project={project} stageKey={activeTab} />
      )}
    </div>
  );
}

/* ── Shared multi-line metric renderer ── */
function MetricLines({ value }: { value: string | null | undefined }) {
  if (!value) return <p className="text-xs italic text-muted-foreground/50">Not set</p>;
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
  project,
  stageKey,
}: {
  project: ProjectWithRelations;
  stageKey: string;
}) {
  const config = STAGE_CONFIG[stageKey];
  if (!config || config.fields.length === 0) return null;

  return (
    <section className="space-y-2">
      <div className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
        {config.icon}
        <span>Details</span>
      </div>
      <div className="space-y-2">
        {config.fields.map(({ key, label }) => {
          const value = (project[key] as string) ?? "";
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

/* ── Combined flag + experiment plan section (implementing) ── */
function FlagAndExperimentSection({
  project,
}: {
  project: ProjectWithRelations;
}) {
  const experiments = project.experiments;

  const { sorted, isSequential } = sortAndDetectSequential(experiments);

  return (
    <section className="space-y-3">
      {/* Section header */}
      <div className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
        <Flag className="size-3.5" />
        <span>Feature Flag &amp; Experiments</span>
        {experiments.length > 0 && (
          <span className="ml-auto text-[10px] tabular-nums">
            {experiments.length} experiment{experiments.length > 1 ? "s" : ""}
          </span>
        )}
      </div>

      {/* Flag config — editable form */}
      <FlagConfig project={project} />

      {/* Traffic pool overview */}
      {experiments.length > 0 && (
        <TrafficPoolView experiments={sorted} />
      )}

      {/* Experiment cards */}
      <div className="space-y-3">
        {sorted.map((exp, idx) => (
          <div key={exp.id} className="rounded-md border space-y-0">
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
              <span className="text-xs font-mono font-medium">{exp.slug}</span>
              <div className="ml-auto flex items-center gap-1.5">
                {exp.method && <MethodBadge method={exp.method} />}
                <StatusBadge status={exp.status} />
              </div>
            </div>

            <div className="px-3 py-2 space-y-2">
              {/* Variants */}
              <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
                {exp.controlVariant && (
                  <span>
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

              {/* Observation window + sample */}
              <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                {exp.minimumSample && (
                  <span>
                    Min sample: <span className="tabular-nums font-medium text-foreground">{exp.minimumSample}</span>/variant
                  </span>
                )}
                {exp.observationStart && exp.observationEnd && (
                  <span>
                    <Calendar className="inline size-3 mr-0.5" />
                    {fmtDate(exp.observationStart)} → {fmtDate(exp.observationEnd)}
                  </span>
                )}
              </div>

              {/* Traffic allocation — highlighted */}
              {exp.trafficAllocation && (
                <div className="rounded-md border border-amber-200 bg-amber-50/50 dark:border-amber-800 dark:bg-amber-950/30 px-2.5 py-1.5">
                  <SectionLabel icon={<Flag className="size-3 text-amber-600 dark:text-amber-400" />} label="Traffic Allocation" />
                  <p className="text-xs leading-relaxed">
                    {exp.trafficAllocation}
                  </p>
                </div>
              )}

              {/* Method reason */}
              {exp.methodReason && (
                <div>
                  <SectionLabel icon={<Info className="size-3" />} label="Why This Method" />
                  <p className="text-xs leading-relaxed text-muted-foreground">
                    {exp.methodReason}
                  </p>
                </div>
              )}

              {/* Audience & Traffic */}
              <div>
                <SectionLabel icon={<Filter className="size-3" />} label="Audience &amp; Traffic" />
                <ExperimentTrafficConfig experiment={exp} projectId={project.id} />
              </div>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

/* ── Measuring: metrics overview + rich experiment cards ── */
function MeasuringContent({
  project,
}: {
  project: ProjectWithRelations;
}) {
  const { sorted, isSequential } = sortAndDetectSequential(project.experiments);

  return (
    <>
      {/* North star metric + guardrails */}
      <section className="space-y-2">
        <div className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
          <BarChart3 className="size-3.5" />
          <span>Project Metrics</span>
        </div>
        <div className="space-y-2">
          <div>
            <span className="text-[10px] font-medium text-muted-foreground uppercase">
              Primary Metric (North Star)
            </span>
            <MetricLines value={project.primaryMetric} />
          </div>
          <div>
            <span className="text-[10px] font-medium text-muted-foreground uppercase">
              Guardrails
            </span>
            <MetricLines value={project.guardrails} />
          </div>
        </div>
      </section>

      {/* Experiment cards */}
      <section className="space-y-2">
        <div className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
          <FlaskConical className="size-3.5" />
          <span>Experiments</span>
          <span className="ml-auto text-[10px] tabular-nums">
            {sorted.length}
          </span>
        </div>
        {sorted.length === 0 ? (
          <div className="rounded-md border border-dashed p-3 text-center">
            <p className="text-xs text-muted-foreground/60">
              No experiments yet
            </p>
            <p className="text-[10px] text-muted-foreground/40 mt-1">
              Experiments will appear here once the agent sets them up.
            </p>
          </div>
        ) : (
          <ExperimentTable experiments={sorted} projectId={project.id} isSequential={isSequential} />
        )}
      </section>
    </>
  );
}



/* ── Experiment learnings (learning tab) ── */
function LearningSection({
  experiments,
}: {
  experiments: Experiment[];
}) {
  const { sorted, isSequential } = sortAndDetectSequential(experiments);
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
        <span>Experiment Learnings</span>
      </div>
      {withLearnings.length === 0 ? (
        <div className="rounded-md border border-dashed p-3 text-center">
          <p className="text-xs text-muted-foreground/60">
            No learnings captured yet.
          </p>
          <p className="text-[10px] text-muted-foreground/40 mt-1">
            Learnings will be recorded after experiments are analyzed.
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
      : status === "running"
        ? "bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300"
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


