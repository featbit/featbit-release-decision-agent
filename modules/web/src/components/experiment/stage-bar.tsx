"use client";

import { STAGES } from "@/lib/stages";
import { cn } from "@/lib/utils";
import type { Experiment, ExperimentRun } from "@/generated/prisma";

type ExperimentLike = Experiment & { experimentRuns: ExperimentRun[] };

/** Determine whether a stage has any content filled in. */
function stageHasContent(experiment: ExperimentLike, stageKey: string): boolean {
  switch (stageKey) {
    case "hypothesis":
      return Boolean(experiment.goal || experiment.intent || experiment.hypothesis || experiment.change || experiment.constraints);
    case "implementing":
      return Boolean(experiment.flagKey || experiment.variants);
    case "measuring":
      return Boolean(
        experiment.primaryMetric ||
          experiment.guardrails ||
          experiment.experimentRuns.length > 0 ||
          experiment.experimentRuns.some((e) => e.decision)
      );
    case "learning":
      return Boolean(
        experiment.lastLearning ||
          experiment.experimentRuns.some(
            (e) => e.whatChanged || e.whatHappened || e.nextHypothesis
          )
      );
    default:
      return false;
  }
}

interface StageStepperProps {
  experiment: ExperimentLike;
  activeTab: string;
  onStageSelect: (stageKey: string) => void;
}

// Chevron arrow-tip width in pixels. Each middle step has a right-pointing tip
// and a matching left notch so neighbors interlock.
const POINT = 10;

function chevronClip(isFirst: boolean, isLast: boolean): string | undefined {
  if (isFirst && isLast) return undefined;
  if (isFirst)
    return `polygon(0 0, calc(100% - ${POINT}px) 0, 100% 50%, calc(100% - ${POINT}px) 100%, 0 100%)`;
  if (isLast)
    return `polygon(0 0, 100% 0, 100% 100%, 0 100%, ${POINT}px 50%)`;
  return `polygon(0 0, calc(100% - ${POINT}px) 0, 100% 50%, calc(100% - ${POINT}px) 100%, 0 100%, ${POINT}px 50%)`;
}

export function StageStepper({
  experiment,
  activeTab,
  onStageSelect,
}: StageStepperProps) {
  return (
    <nav className="flex items-stretch gap-0.5 px-2 py-1 border-b shrink-0 bg-muted/20">
      {STAGES.map((stage, i) => {
        const isSelected = stage.key === activeTab;
        const hasContent = stageHasContent(experiment, stage.key);
        const isFirst = i === 0;
        const isLast = i === STAGES.length - 1;
        const clipPath = chevronClip(isFirst, isLast);

        return (
          <button
            key={stage.key}
            type="button"
            onClick={() => onStageSelect(stage.key)}
            style={{ clipPath }}
            className={cn(
              "flex-1 flex flex-col justify-center py-1 text-left transition-all cursor-pointer min-w-0 leading-tight",
              isFirst ? "pl-3" : "pl-5",
              isLast ? "pr-3" : "pr-5",
              isSelected
                ? "bg-foreground text-background [filter:drop-shadow(0_2px_3px_rgb(0_0_0_/_0.18))] -translate-y-px"
                : "bg-muted text-muted-foreground hover:bg-muted/70 hover:text-foreground"
            )}
          >
            <span className="flex items-center gap-1.5 text-[11px] font-semibold w-full min-w-0">
              <span
                className={cn(
                  "size-1 rounded-full shrink-0",
                  hasContent
                    ? isSelected
                      ? "bg-background"
                      : "bg-foreground"
                    : isSelected
                      ? "bg-background/40"
                      : "bg-muted-foreground/30"
                )}
              />
              <span className="truncate">{stage.label}</span>
            </span>
            <span
              className={cn(
                "text-[9px] font-normal pl-2.5 truncate w-full",
                isSelected
                  ? "text-background/60"
                  : "text-muted-foreground/60"
              )}
            >
              {stage.cf}
            </span>
          </button>
        );
      })}
    </nav>
  );
}
