import { getStage } from "@/lib/stages";
import { Badge } from "@/components/ui/badge";
import {
  Target,
  Lightbulb,
  FlaskConical,
  BarChart3,
  Flag,
  Eye,
  Gauge,
  BookOpen,
  LineChart,
} from "lucide-react";
import type { Project, Experiment } from "@/generated/prisma/client";

type ProjectWithRelations = Project & {
  experiments: Experiment[];
};

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
    ],
  },
  exposing: {
    icon: <Eye className="size-3.5" />,
    fields: [
      { key: "primaryMetric", label: "Primary Metric" },
      { key: "variants", label: "Variants" },
    ],
  },
  measuring: {
    icon: <BarChart3 className="size-3.5" />,
    fields: [], // measuring has its own custom layout
  },
  deciding: {
    icon: <Gauge className="size-3.5" />,
    fields: [
      { key: "primaryMetric", label: "Primary Metric" },
      { key: "guardrails", label: "Guardrails" },
    ],
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
      ) : activeTab === "implementing" || activeTab === "exposing" ? (
        <>
          <FieldsSection project={project} stageKey={activeTab} />
          <FeatureFlagSection project={project} />
        </>
      ) : activeTab === "deciding" ? (
        <>
          <FieldsSection project={project} stageKey={activeTab} />
          <ExperimentsDecisionSection experiments={project.experiments} />
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
              <p className="text-xs leading-relaxed">
                {value || (
                  <span className="italic text-muted-foreground/50">
                    Not set
                  </span>
                )}
              </p>
            </div>
          );
        })}
      </div>
    </section>
  );
}

/* ── Feature flag section (implementing / exposing) ── */
function FeatureFlagSection({
  project,
}: {
  project: ProjectWithRelations;
}) {
  const isConfigured = Boolean(project.flagKey && project.envSecret);

  return (
    <section className="space-y-2">
      <div className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
        <Flag className="size-3.5" />
        <span>Feature Flag</span>
        <Badge
          variant={isConfigured ? "secondary" : "outline"}
          className="ml-auto text-[10px]"
        >
          {isConfigured ? "Configured" : "Not set"}
        </Badge>
      </div>
      {isConfigured ? (
        <div className="space-y-1">
          <div>
            <span className="text-[10px] font-medium text-muted-foreground uppercase">
              Key
            </span>
            <p className="text-xs font-mono">{project.flagKey}</p>
          </div>
          {project.flagServerUrl && (
            <div>
              <span className="text-[10px] font-medium text-muted-foreground uppercase">
                Server
              </span>
              <p className="text-xs font-mono truncate">
                {project.flagServerUrl}
              </p>
            </div>
          )}
        </div>
      ) : (
        <p className="text-xs text-muted-foreground/50 italic">
          The agent will configure the flag during implementation.
        </p>
      )}
    </section>
  );
}

/* ── Measuring: metrics + AB testing + data analysis ── */
function MeasuringContent({
  project,
}: {
  project: ProjectWithRelations;
}) {
  return (
    <>
      {/* North star metric + guardrails */}
      <section className="space-y-2">
        <div className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
          <BarChart3 className="size-3.5" />
          <span>Metrics</span>
        </div>
        <div className="space-y-2">
          <div>
            <span className="text-[10px] font-medium text-muted-foreground uppercase">
              Primary Metric (North Star)
            </span>
            <p className="text-xs leading-relaxed">
              {project.primaryMetric || (
                <span className="italic text-muted-foreground/50">
                  Not set
                </span>
              )}
            </p>
          </div>
          <div>
            <span className="text-[10px] font-medium text-muted-foreground uppercase">
              Guardrails
            </span>
            <p className="text-xs leading-relaxed">
              {project.guardrails || (
                <span className="italic text-muted-foreground/50">
                  Not set
                </span>
              )}
            </p>
          </div>
        </div>
      </section>

      {/* A/B Testing */}
      <section className="space-y-2">
        <div className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
          <FlaskConical className="size-3.5" />
          <span>A/B Testing</span>
          <span className="ml-auto text-[10px] tabular-nums">
            {project.experiments.length}
          </span>
        </div>
        {project.experiments.length === 0 ? (
          <div className="rounded-md border border-dashed p-3 text-center">
            <p className="text-xs text-muted-foreground/60">
              No experiments yet
            </p>
            <p className="text-[10px] text-muted-foreground/40 mt-1">
              Experiments will appear here once the agent sets them up.
            </p>
          </div>
        ) : (
          <div className="space-y-1.5">
            {project.experiments.map((exp) => (
              <div
                key={exp.id}
                className="rounded border px-2 py-1.5 space-y-0.5"
              >
                <div className="flex items-center justify-between">
                  <span className="text-xs font-mono">{exp.slug}</span>
                  <Badge variant="outline" className="text-[10px]">
                    {exp.status}
                  </Badge>
                </div>
                {exp.primaryMetricEvent && (
                  <p className="text-[10px] text-muted-foreground">
                    Metric: {exp.primaryMetricEvent}
                  </p>
                )}
                {exp.decision && (
                  <p className="text-[10px] text-muted-foreground">
                    Decision: {exp.decision}
                  </p>
                )}
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Data Analysis — placeholder */}
      <section className="space-y-2">
        <div className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
          <LineChart className="size-3.5" />
          <span>Data Analysis</span>
          <Badge variant="outline" className="ml-auto text-[10px]">
            Coming soon
          </Badge>
        </div>
        <div className="rounded-md border border-dashed p-3 text-center space-y-1">
          <p className="text-xs text-muted-foreground/60">
            Funnel analysis, session replay, and more
          </p>
          <p className="text-[10px] text-muted-foreground/40">
            Data analysis tools will be available in a future update.
          </p>
        </div>
      </section>
    </>
  );
}

/* ── Experiment decisions (deciding tab) ── */
function ExperimentsDecisionSection({
  experiments,
}: {
  experiments: Experiment[];
}) {
  return (
    <section className="space-y-2">
      <div className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
        <FlaskConical className="size-3.5" />
        <span>Experiment Results</span>
      </div>
      {experiments.length === 0 ? (
        <p className="text-xs text-muted-foreground/50 italic">
          No experiments to evaluate.
        </p>
      ) : (
        <div className="space-y-1.5">
          {experiments.map((exp) => (
            <div
              key={exp.id}
              className="rounded border px-2 py-1.5 space-y-0.5"
            >
              <div className="flex items-center justify-between">
                <span className="text-xs font-mono">{exp.slug}</span>
                <Badge variant="outline" className="text-[10px]">
                  {exp.status}
                </Badge>
              </div>
              <div>
                <span className="text-[10px] font-medium text-muted-foreground uppercase">
                  Decision
                </span>
                <p className="text-xs">
                  {exp.decision || (
                    <span className="italic text-muted-foreground/50">
                      Pending
                    </span>
                  )}
                </p>
              </div>
              {exp.decisionReason && (
                <div>
                  <span className="text-[10px] font-medium text-muted-foreground uppercase">
                    Reason
                  </span>
                  <p className="text-xs leading-relaxed">
                    {exp.decisionReason}
                  </p>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

/* ── Experiment learnings (learning tab) ── */
function LearningSection({
  experiments,
}: {
  experiments: Experiment[];
}) {
  const withLearnings = experiments.filter(
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
          {withLearnings.map((exp) => (
            <div key={exp.id} className="rounded border px-2 py-2 space-y-1">
              <span className="text-xs font-mono font-medium">{exp.slug}</span>
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
          ))}
        </div>
      )}
    </section>
  );
}


