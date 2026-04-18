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
  const router = useRouter();

  // Auto-refresh every 15 seconds to pick up new analysis results from the Worker
  useEffect(() => {
    const id = setInterval(() => router.refresh(), 15_000);
    return () => clearInterval(id);
  }, [router]);

  function triggerChat(message: string) {
    setPendingChatMessage(message);
    setRightCollapsed(false);
  }

  return (
    <ChatTriggerContext.Provider value={triggerChat}>
      {/* ── Header ── */}
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
          <h1 className="text-sm font-semibold truncate">
            {experiment.name}
          </h1>
          <div className="ml-auto flex items-center gap-2">
            <WorkspaceSwitcher readOnly />
            <ActivityPopover activities={experiment.activities} />
          </div>
        </div>
      </header>

      {/* ── Main: resizable left (stages) / right (chat) ── */}
      <ResizablePanels
        rightCollapsed={rightCollapsed}
        onRightCollapsedChange={setRightCollapsed}
        left={
          <div className="flex h-full">
            {/* Vertical stage sidebar */}
            <StageSidebar
              experiment={experiment}
              activeTab={activeTab}
              onStageSelect={setActiveTab}
            />
            {/* Stage content */}
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
    </ChatTriggerContext.Provider>
  );
}
