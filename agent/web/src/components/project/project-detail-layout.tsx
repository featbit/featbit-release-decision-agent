"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { StageSidebar } from "@/components/project/stage-bar";
import { StageContentPanel } from "@/components/project/stage-content-panel";
import { ChatPanel } from "@/components/project/chat-panel";
import { ResizablePanels } from "@/components/project/resizable-panels";
import { ActivityPopover } from "@/components/project/activity-popover";
import { ProjectActions } from "@/components/project/project-actions";
import type {
  Project,
  Experiment,
  Activity,
  Message,
} from "@/generated/prisma/client";

type ProjectWithRelations = Project & {
  experiments: Experiment[];
  activities: Activity[];
  messages: Message[];
};

interface ProjectDetailLayoutProps {
  project: ProjectWithRelations;
}

export function ProjectDetailLayout({ project }: ProjectDetailLayoutProps) {
  const [activeTab, setActiveTab] = useState(project.stage);

  return (
    <>
      {/* ── Header ── */}
      <header className="border-b shrink-0">
        <div className="flex items-center gap-3 px-4 py-2">
          <Link
            href="/projects"
            className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            <ArrowLeft className="size-3.5" />
            Projects
          </Link>
          <span className="text-muted-foreground/40">|</span>
          <h1 className="text-sm font-semibold truncate">{project.name}</h1>
          <div className="ml-auto flex items-center gap-2">
            <ActivityPopover activities={project.activities} />
            <ProjectActions
              projectId={project.id}
              projectName={project.name}
            />
          </div>
        </div>
      </header>

      {/* ── Main: resizable left (stages) / right (chat) ── */}
      <ResizablePanels
        left={
          <div className="flex h-full">
            {/* Vertical stage sidebar */}
            <StageSidebar
              project={project}
              activeTab={activeTab}
              onStageSelect={setActiveTab}
            />
            {/* Stage content */}
            <div className="flex-1 min-w-0">
              <StageContentPanel project={project} activeTab={activeTab} />
            </div>
          </div>
        }
        right={
          <ChatPanel projectId={project.id} messages={project.messages} />
        }
      />
    </>
  );
}
