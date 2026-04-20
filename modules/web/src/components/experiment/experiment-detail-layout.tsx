"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { StageSidebar } from "@/components/experiment/stage-bar";
import { StageContentPanel } from "@/components/experiment/stage-content-panel";
import { ChatPanel } from "@/components/experiment/chat-panel";
import { ResizablePanels } from "@/components/experiment/resizable-panels";
import { ActivityPopover } from "@/components/experiment/activity-popover";
import { ChatTriggerContext } from "@/components/experiment/chat-trigger-context";
import { EntryModePicker, ModeSwitchDialog } from "@/components/experiment/entry-mode-picker";
import { ExpertSetupDialog } from "@/components/experiment/expert-setup-dialog";
import { Button } from "@/components/ui/button";
import { Pencil, Shuffle } from "lucide-react";
import { WorkspaceSwitcher } from "@/components/workspace/workspace-switcher";
import type {
  Experiment,
  ExperimentRun,
  Activity,
  Message,
} from "@/generated/prisma";

type ExperimentWithRelations = Experiment & {
  experimentRuns: ExperimentRun[];
  activities: Activity[];
  messages: Message[];
};

interface ExperimentDetailLayoutProps {
  experiment: ExperimentWithRelations;
}

export function ExperimentDetailLayout({ experiment }: ExperimentDetailLayoutProps) {
  const [activeTab, setActiveTab] = useState(
    // Map legacy "intent" stage to merged "hypothesis" tab
    experiment.stage === "intent" ? "hypothesis" : experiment.stage
  );
  const [rightCollapsed, setRightCollapsed] = useState(false);
  const [pendingChatMessage, setPendingChatMessage] = useState<string | null>(null);
  const [expertEditOpen, setExpertEditOpen] = useState(false);
  const [switchOpen, setSwitchOpen] = useState(false);
  const router = useRouter();

  // Experiments created before this feature have entryMode=null and existing
  // content (messages, runs, stage != initial) — treat those as "guided" so we
  // don't interrupt legacy experiments with the picker.
  const hasPriorWork =
    experiment.messages.length > 0 ||
    experiment.experimentRuns.length > 0 ||
    !!experiment.hypothesis ||
    !!experiment.intent;
  const entryMode: "guided" | "expert" | null =
    experiment.entryMode === "guided" || experiment.entryMode === "expert"
      ? experiment.entryMode
      : hasPriorWork
        ? "guided"
        : null;

  // Auto-refresh every 15 seconds to pick up new analysis results from the Worker
  useEffect(() => {
    const id = setInterval(() => router.refresh(), 15_000);
    return () => clearInterval(id);
  }, [router]);

  function triggerChat(message: string) {
    setPendingChatMessage(message);
    setRightCollapsed(false);
  }

  const header = (
    <header className="border-b shrink-0">
      <div className="flex items-center gap-3 px-4 py-2">
        <Link
          href="/experiments"
          className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft className="size-3.5" />
          Experiments
        </Link>
        <span className="text-muted-foreground/40">|</span>
        <h1 className="text-sm font-semibold truncate">{experiment.name}</h1>
        <div className="ml-auto flex items-center gap-2">
          {entryMode !== null && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => setSwitchOpen(true)}
              className="h-7 text-xs"
              title="Switch between guided and expert setup"
            >
              <Shuffle className="size-3" />
              Switch mode
            </Button>
          )}
          {entryMode === "expert" && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => setExpertEditOpen(true)}
              className="h-7 text-xs"
            >
              <Pencil className="size-3" />
              Edit setup
            </Button>
          )}
          <WorkspaceSwitcher readOnly />
          <ActivityPopover activities={experiment.activities} />
        </div>
      </div>
    </header>
  );

  function handleExpertSaved(summary: string) {
    setPendingChatMessage(summary);
    setActiveTab("measuring");
  }

  // ── Entry mode not yet selected: show the picker full-width ──
  if (entryMode === null) {
    return (
      <>
        {header}
        <EntryModePicker
          experiment={experiment}
          onExpertSaved={handleExpertSaved}
        />
      </>
    );
  }

  // ── Guided and expert modes both render the stage UI + AI chat panel.
  // The only surface-level difference is the header "Edit setup" button
  // (which opens the expert wizard) rendered above. Data is shared. ──
  return (
    <ChatTriggerContext.Provider value={triggerChat}>
      {header}
      <ResizablePanels
        rightCollapsed={rightCollapsed}
        onRightCollapsedChange={setRightCollapsed}
        left={
          <div className="flex h-full">
            <StageSidebar
              experiment={experiment}
              activeTab={activeTab}
              onStageSelect={setActiveTab}
            />
            <div className="flex-1 min-w-0">
              <StageContentPanel experiment={experiment} activeTab={activeTab} />
            </div>
          </div>
        }
        right={
          <ChatPanel
            experimentId={experiment.id}
            messages={experiment.messages}
            triggerMessage={pendingChatMessage}
            onTriggerConsumed={() => setPendingChatMessage(null)}
          />
        }
      />
      <ExpertSetupDialog
        experiment={experiment}
        open={expertEditOpen}
        onOpenChange={setExpertEditOpen}
        onSaved={handleExpertSaved}
      />
      <ModeSwitchDialog
        experiment={experiment}
        currentMode={entryMode}
        open={switchOpen}
        onOpenChange={setSwitchOpen}
        onExpertSaved={handleExpertSaved}
      />
    </ChatTriggerContext.Provider>
  );
}
