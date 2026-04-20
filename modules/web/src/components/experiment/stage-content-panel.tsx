"use client";

import { useState } from "react";
import { getStage } from "@/lib/stages";
import { EditDecisionStateDialog } from "./decision-state-edit";
import { MetricEditDialog } from "./metric-edit";
import { Badge } from "@/components/ui/badge";
import { ExperimentActions } from "./experiment-actions";
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
  Pencil,
  Activity,
  ExternalLink,
  ShieldAlert,
  ShieldCheck,
  Target,
  Settings as SettingsIcon,
} from "lucide-react";
import type { Experiment, ExperimentRun } from "@/generated/prisma";
import {
  FlagIntegrationHeader,
  FlagIntegrationPanel,
  SdkCredentialsPopup,
} from "./flag-config";
import { Button } from "@/components/ui/button";
import { MetricEditPanel } from "./metric-edit";
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
      { key: "description", label: "Description" },
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
  if (activeTab === "settings") {
    return <SettingsContent experiment={experiment} />;
  }

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

/* ── Settings pseudo-stage ── */
function SettingsContent({
  experiment,
}: {
  experiment: ExperimentWithRelations;
}) {
  return (
    <div className="h-full overflow-y-auto p-5 space-y-5">
      <div className="space-y-1">
        <div className="flex items-center gap-2">
          <SettingsIcon className="size-4" />
          <span className="text-sm font-semibold">Settings</span>
        </div>
        <p className="text-xs text-muted-foreground">
          Administrative actions for this experiment.
        </p>
      </div>

      <section className="space-y-2">
        <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
          Metadata
        </div>
        <div className="rounded-md border bg-muted/10 px-3 py-3 space-y-2 text-xs">
          <div>
            <span className="text-[10px] font-medium text-muted-foreground uppercase">Name</span>
            <p className="leading-relaxed">{experiment.name}</p>
          </div>
          <div>
            <span className="text-[10px] font-medium text-muted-foreground uppercase">Description</span>
            <p className="leading-relaxed whitespace-pre-line">
              {experiment.description || (
                <span className="italic text-muted-foreground/50">Not set (edit in Hypothesis stage)</span>
              )}
            </p>
          </div>
          <div>
            <span className="text-[10px] font-medium text-muted-foreground uppercase">Experiment ID</span>
            <p className="font-mono text-[11px] text-muted-foreground">{experiment.id}</p>
          </div>
          {experiment.featbitEnvId && (
            <div>
              <span className="text-[10px] font-medium text-muted-foreground uppercase">FeatBit Env ID</span>
              <p className="font-mono text-[11px] text-muted-foreground">{experiment.featbitEnvId}</p>
            </div>
          )}
        </div>
      </section>

      <section className="space-y-2">
        <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
          Danger zone
        </div>
        <div className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-3 space-y-3">
          <p className="text-xs text-muted-foreground leading-relaxed">
            Deleting an experiment permanently removes its runs, activity, and chat history. This cannot be undone.
          </p>
          <ExperimentActions experimentId={experiment.id} experimentName={experiment.name} />
        </div>
      </section>
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
  const { sorted } = sortAndDetectSequential(experimentRuns);

  // Full-screen edit panels replace stage content so the right-side chat agent
  // stays visible (vs a Sheet overlay that would cover it).
  const [flagPanelOpen, setFlagPanelOpen] = useState(false);
  const [metricsPanelOpen, setMetricsPanelOpen] = useState(false);
  const [sdkCredsOpen, setSdkCredsOpen] = useState(false);

  if (flagPanelOpen) {
    return (
      <div className="min-h-[70vh]">
        <FlagIntegrationPanel
          experiment={experiment}
          experimentRuns={sorted}
          onClose={() => setFlagPanelOpen(false)}
          onEditAdvanced={() => setSdkCredsOpen(true)}
        />
        <SdkCredentialsPopup
          experiment={experiment}
          open={sdkCredsOpen}
          onOpenChange={setSdkCredsOpen}
        />
      </div>
    );
  }

  if (metricsPanelOpen) {
    return (
      <div className="min-h-[70vh]">
        <MetricEditPanel
          experiment={experiment}
          onClose={() => setMetricsPanelOpen(false)}
        />
      </div>
    );
  }

  return (
    <>
      {/* ─── Section 1: Flag Integration & Rollout (summary) ─── */}
      <FlagIntegrationHeader
        experiment={experiment}
        experimentRuns={sorted}
        onEdit={() => setFlagPanelOpen(true)}
      />

      {/* ─── Section 2: Metrics Integration ─── */}
      <MetricsIntegrationSection
        experiment={experiment}
        experimentRuns={sorted}
        onEdit={() => setMetricsPanelOpen(true)}
      />
    </>
  );
}

/* ── Metrics integration section ── */
type PrimaryMetric = {
  name?: string;
  event?: string;
  metricType?: "binary" | "numeric";
  metricAgg?: "once" | "count" | "sum";
  description?: string;
};

type GuardrailMetric = {
  name?: string;
  event?: string;
  metricType?: "binary" | "numeric";
  metricAgg?: "once" | "count" | "sum";
  direction?: "increase_bad" | "decrease_bad";
  description?: string;
};

function parsePrimary(raw: string | null | undefined): PrimaryMetric | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw);
    if (v && typeof v === "object" && !Array.isArray(v)) return v;
  } catch {
    // legacy free text → treat as display name
    return { name: raw };
  }
  return null;
}

function parseGuardrails(raw: string | null | undefined): GuardrailMetric[] {
  if (!raw) return [];
  try {
    const v = JSON.parse(raw);
    if (Array.isArray(v)) return v as GuardrailMetric[];
  } catch {
    return raw
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean)
      .map((l) => {
        const m = l.match(/^(.+?)\s*[—–-]+\s*(.+)$/);
        return m ? { name: m[1].trim(), description: m[2].trim() } : { name: l };
      });
  }
  return [];
}

function MetricsIntegrationSection({
  experiment,
  onEdit,
}: {
  experiment: ExperimentWithRelations;
  experimentRuns: ExperimentRun[];
  onEdit: () => void;
}) {
  const primary = parsePrimary(experiment.primaryMetric);
  const guardrails = parseGuardrails(experiment.guardrails);

  return (
    <section className="space-y-3">
      <div className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
        <Activity className="size-3.5" />
        <span>Metrics Integration</span>
        <button
          type="button"
          onClick={onEdit}
          className="ml-1 text-muted-foreground/50 hover:text-foreground transition-colors"
          title="Edit metrics"
        >
          <Pencil className="size-3" />
        </button>
      </div>

      <div className="space-y-3">
        {/* Primary metric — prominent card */}
        <div className="rounded-md border-2 border-blue-200 dark:border-blue-900/60 bg-blue-50/30 dark:bg-blue-950/20 px-4 py-3 space-y-2">
          <div className="flex items-center gap-2">
            <Target className="size-3.5 text-blue-700 dark:text-blue-300" />
            <span className="text-[10px] font-semibold text-blue-700 dark:text-blue-300 uppercase tracking-wider">
              Primary Metric (North Star)
            </span>
          </div>
          {primary ? (
            <PrimaryMetricBody m={primary} />
          ) : (
            <p className="text-xs italic text-muted-foreground/50">Not set</p>
          )}
        </div>

        {/* Guardrails — secondary, stacked cards */}
        <div className="rounded-md border bg-muted/10 px-4 py-3 space-y-2">
          <div className="flex items-center gap-2">
            <ShieldCheck className="size-3.5 text-muted-foreground" />
            <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
              Guardrails
            </span>
            {guardrails.length > 0 && (
              <Badge variant="outline" className="text-[10px] py-0 px-1.5">
                {guardrails.length}
              </Badge>
            )}
          </div>
          {guardrails.length === 0 ? (
            <p className="text-xs italic text-muted-foreground/50">None defined</p>
          ) : (
            <ul className="space-y-2">
              {guardrails.map((g, i) => (
                <li key={i}>
                  <GuardrailBody g={g} />
                </li>
              ))}
            </ul>
          )}
        </div>

        <div>
          <Button variant="outline" size="sm" onClick={onEdit} className="gap-1.5">
            <Pencil className="size-3.5" />
            Edit Metrics
          </Button>
        </div>
      </div>
    </section>
  );
}

function PrimaryMetricBody({ m }: { m: PrimaryMetric }) {
  return (
    <div className="space-y-1.5">
      <LabelValue label="Name">
        {m.name ? (
          <span className="text-sm font-semibold">{m.name}</span>
        ) : (
          <span className="italic text-muted-foreground/50">unset</span>
        )}
      </LabelValue>
      <LabelValue label="Event Key">
        {m.event ? (
          <span className="rounded bg-muted px-1.5 py-0.5 text-[11px] font-mono">
            {m.event}
          </span>
        ) : (
          <span className="italic text-muted-foreground/50 text-xs">unset</span>
        )}
      </LabelValue>
      <LabelValue label="Type">
        <span className="text-xs">{m.metricType ?? "—"}</span>
      </LabelValue>
      <LabelValue label="Aggregation">
        <span className="text-xs">
          {m.metricAgg === "once"
            ? "once per user"
            : m.metricAgg === "count"
              ? "count all"
              : m.metricAgg === "sum"
                ? "sum values"
                : "—"}
        </span>
      </LabelValue>
      {m.description && (
        <LabelValue label="Description">
          <p className="text-[11px] text-muted-foreground/90 leading-relaxed">
            {m.description}
          </p>
        </LabelValue>
      )}
    </div>
  );
}

function GuardrailBody({ g }: { g: GuardrailMetric }) {
  const dirLabel =
    g.direction === "decrease_bad"
      ? "alarm if ↓ decreases"
      : g.direction === "increase_bad"
        ? "alarm if ↑ increases"
        : null;
  return (
    <div className="rounded border bg-background px-3 py-2 space-y-1.5">
      <LabelValue label="Name">
        {g.name ? (
          <span className="text-xs font-semibold">{g.name}</span>
        ) : (
          <span className="italic text-muted-foreground/50 text-xs">unset</span>
        )}
      </LabelValue>
      <LabelValue label="Event Key">
        {g.event ? (
          <span className="inline-flex items-center gap-1 rounded bg-muted px-1.5 py-0.5 text-[11px] font-mono">
            <Code className="size-3 text-muted-foreground" />
            {g.event}
          </span>
        ) : (
          <span className="italic text-muted-foreground/50 text-xs">unset</span>
        )}
      </LabelValue>
      <div className="grid grid-cols-[6rem_1fr] gap-x-3 items-baseline">
        <span className="text-[10px] font-medium text-muted-foreground uppercase">
          Type
        </span>
        <span className="text-xs">{g.metricType ?? "—"}</span>
      </div>
      <div className="grid grid-cols-[6rem_1fr] gap-x-3 items-baseline">
        <span className="text-[10px] font-medium text-muted-foreground uppercase">
          Aggregation
        </span>
        <span className="text-xs">
          {g.metricAgg === "once"
            ? "once per user"
            : g.metricAgg === "count"
              ? "count all"
              : g.metricAgg === "sum"
                ? "sum values"
                : "—"}
        </span>
      </div>
      {dirLabel && (
        <div className="grid grid-cols-[6rem_1fr] gap-x-3 items-baseline">
          <span className="text-[10px] font-medium text-muted-foreground uppercase">
            Alarm
          </span>
          <span className="text-xs font-mono text-rose-600 dark:text-rose-400">
            {dirLabel}
          </span>
        </div>
      )}
      {g.description && (
        <div className="grid grid-cols-[6rem_1fr] gap-x-3 items-baseline">
          <span className="text-[10px] font-medium text-muted-foreground uppercase">
            Description
          </span>
          <p className="text-[11px] text-muted-foreground/90 leading-relaxed">
            {g.description}
          </p>
        </div>
      )}
    </div>
  );
}

function LabelValue({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="grid grid-cols-[6rem_1fr] gap-x-3 items-baseline">
      <span className="text-[10px] font-medium text-muted-foreground uppercase">
        {label}
      </span>
      <div>{children}</div>
    </div>
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
      {/* Metrics are defined in Implementing — not duplicated here. */}

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
  ROLLBACK: "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300",
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

