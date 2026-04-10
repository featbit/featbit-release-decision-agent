import { getStage } from "@/lib/stages";
import { Badge } from "@/components/ui/badge";
import {
  Target,
  Lightbulb,
  FlaskConical,
  BarChart3,
  Flag,
  ScrollText,
} from "lucide-react";
import type { Project, Experiment, Activity } from "@/generated/prisma/client";

/* ── Field metadata per stage ── */
const STAGE_FIELDS: Record<string, { fields: string[]; icon: React.ReactNode }> = {
  intent: { fields: ["goal", "intent"], icon: <Target className="size-3.5" /> },
  hypothesis: {
    fields: ["goal", "intent", "hypothesis", "change"],
    icon: <Lightbulb className="size-3.5" />,
  },
  implementing: {
    fields: ["goal", "hypothesis", "change", "primaryMetric"],
    icon: <FlaskConical className="size-3.5" />,
  },
  measuring: {
    fields: ["goal", "hypothesis", "primaryMetric", "guardrails"],
    icon: <BarChart3 className="size-3.5" />,
  },
  learning: {
    fields: ["goal", "hypothesis", "primaryMetric"],
    icon: <Lightbulb className="size-3.5" />,
  },
};

const FIELD_LABELS: Record<string, string> = {
  goal: "Goal",
  intent: "Intent",
  hypothesis: "Hypothesis",
  change: "Change",
  primaryMetric: "Primary Metric",
  guardrails: "Guardrails",
};

export function ContextPanel({
  project,
}: {
  project: Project & { experiments: Experiment[]; activities: Activity[] };
}) {
  const stage = getStage(project.stage);
  const config = STAGE_FIELDS[project.stage] ?? STAGE_FIELDS.intent;
  const isConfigured = Boolean(project.flagKey && project.envSecret);

  return (
    <div className="h-full overflow-y-auto p-4 space-y-5 text-sm">
      {/* ── Decision State ── */}
      <section className="space-y-2">
        <div className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
          {config.icon}
          <span>Decision State</span>
          <Badge variant="secondary" className={`ml-auto text-[10px] ${stage.color}`}>
            {stage.cf}
          </Badge>
        </div>
        <div className="space-y-1.5">
          {config.fields.map((field) => {
            const value = (project[field as keyof Project] as string) ?? "";
            return (
              <div key={field}>
                <span className="text-[10px] font-medium text-muted-foreground uppercase">
                  {FIELD_LABELS[field] ?? field}
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

      {/* ── Feature Flag ── */}
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

      {/* ── Experiments ── */}
      {project.experiments.length > 0 && (
        <section className="space-y-2">
          <div className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
            <FlaskConical className="size-3.5" />
            <span>Experiments</span>
            <span className="ml-auto text-[10px] tabular-nums">
              {project.experiments.length}
            </span>
          </div>
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
                {exp.decision && (
                  <p className="text-[10px] text-muted-foreground">
                    Decision: {exp.decision}
                  </p>
                )}
              </div>
            ))}
          </div>
        </section>
      )}

      {/* ── Recent Activity ── */}
      <section className="space-y-2">
        <div className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
          <ScrollText className="size-3.5" />
          <span>Activity</span>
        </div>
        {project.activities.length === 0 ? (
          <p className="text-xs text-muted-foreground/50 italic">
            No activity yet
          </p>
        ) : (
          <div className="space-y-1.5">
            {project.activities.slice(0, 8).map((a) => (
              <div key={a.id} className="text-xs">
                <p className="leading-tight">{a.title}</p>
                <p className="text-[10px] text-muted-foreground/60">
                  {new Date(a.createdAt).toLocaleString()}
                </p>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
