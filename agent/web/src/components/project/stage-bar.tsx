"use client";

import { STAGES } from "@/lib/stages";
import { cn } from "@/lib/utils";
import type { Project, Experiment } from "@/generated/prisma/client";

type ProjectLike = Project & { experiments: Experiment[] };

/** Determine whether a stage has any content filled in. */
function stageHasContent(project: ProjectLike, stageKey: string): boolean {
  switch (stageKey) {
    case "intent":
      return Boolean(project.goal || project.intent);
    case "hypothesis":
      return Boolean(project.hypothesis || project.change);
    case "implementing":
      return Boolean(project.flagKey || project.change || project.variants);
    case "measuring":
      return Boolean(
        project.primaryMetric ||
          project.guardrails ||
          project.experiments.length > 0
      );
    case "deciding":
      return project.experiments.some((e) => e.decision);
    case "learning":
      return Boolean(
        project.lastLearning ||
          project.experiments.some(
            (e) => e.whatChanged || e.whatHappened || e.nextHypothesis
          )
      );
    default:
      return false;
  }
}

interface StageSidebarProps {
  project: ProjectLike;
  activeTab: string;
  onStageSelect: (stageKey: string) => void;
}

export function StageSidebar({
  project,
  activeTab,
  onStageSelect,
}: StageSidebarProps) {
  return (
    <nav className="flex flex-col gap-0.5 p-2 w-40 shrink-0 border-r overflow-y-auto">
      {STAGES.map((stage) => {
        const isSelected = stage.key === activeTab;
        const hasContent = stageHasContent(project, stage.key);

        return (
          <button
            key={stage.key}
            type="button"
            onClick={() => onStageSelect(stage.key)}
            className={cn(
              "flex items-center gap-2 px-2.5 py-2 rounded-md text-xs whitespace-nowrap transition-colors text-left cursor-pointer",
              isSelected
                ? "bg-foreground text-background font-medium"
                : "text-muted-foreground hover:text-foreground hover:bg-muted"
            )}
          >
            <span
              className={cn(
                "size-1.5 rounded-full shrink-0",
                hasContent
                  ? isSelected
                    ? "bg-background"
                    : "bg-foreground"
                  : isSelected
                    ? "bg-background/40"
                    : "bg-muted-foreground/30"
              )}
            />
            <span className="flex flex-col gap-0.5 min-w-0">
              <span className="truncate">{stage.label}</span>
              <span
                className={cn(
                  "text-[10px] font-normal",
                  isSelected
                    ? "text-background/60"
                    : "text-muted-foreground/60"
                )}
              >
                {stage.cf}
              </span>
            </span>
          </button>
        );
      })}
    </nav>
  );
}
