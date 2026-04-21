import Link from "next/link";
import Image from "next/image";
import {
  Sidebar,
  SidebarContent,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuItem,
  SidebarMenuButton,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarGroupContent,
  SidebarSeparator,
  SidebarFooter,
} from "@/components/ui/sidebar";
import {
  FolderKanban,
  Plus,
  Flag,
  Database,
  ExternalLink,
  BrainCircuit,
  Code2,
  FolderOpen,
} from "lucide-react";
import { UserMenu } from "@/components/auth/user-menu";

export function AppSidebar() {
  return (
    <Sidebar>
      <SidebarHeader>
        <Link
          href="/experiments"
          className="flex items-center gap-2 px-2 py-1 group"
        >
          <Image
            src="/logo.svg"
            alt="FeatBit Experimentation"
            width={36}
            height={36}
            className="size-9 shrink-0"
          />
          <div className="flex flex-col leading-tight min-w-0">
            <span className="font-semibold text-sm truncate">FeatBit</span>
            <span className="text-[10px] text-muted-foreground truncate">
              Experimentation
            </span>
          </div>
        </Link>
      </SidebarHeader>
      <SidebarContent>
        {/* ─── Project / env-scoped items ─── */}
        <SidebarGroup>
          <SidebarGroupLabel>Experiments</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton render={<Link href="/experiments" />}>
                  <FolderKanban className="size-4" />
                  <span>All Experiments</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
              <SidebarMenuItem>
                <SidebarMenuButton render={<Link href="/experiments/new" />}>
                  <Plus className="size-4" />
                  <span>New Experiment</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        <SidebarGroup>
          <SidebarGroupLabel>Control</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton
                  render={
                    <a
                      href="https://app.featbit.co"
                      target="_blank"
                      rel="noopener noreferrer"
                    />
                  }
                >
                  <Flag className="size-4" />
                  <span>Feature Flags</span>
                  <ExternalLink className="size-3 ml-auto opacity-50" />
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        <SidebarGroup>
          <SidebarGroupLabel>Data</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton render={<Link href="/data-warehouse" />}>
                  <Database className="size-4" />
                  <span>Data Warehouse</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
              <SidebarMenuItem>
                <SidebarMenuButton render={<Link href="/data/ai-memory" />}>
                  <BrainCircuit className="size-4" />
                  <span>AI Memory</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
              <SidebarMenuItem>
                <SidebarMenuButton render={<Link href="/data/apis-sdks" />}>
                  <Code2 className="size-4" />
                  <span>APIs & SDKs</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        {/* ─── Separator between project/env-scoped and workspace-level items ─── */}
        <SidebarSeparator className="my-2" />

        {/* ─── Workspace-level items (not tied to the current project/env) ─── */}
        <SidebarGroup>
          <SidebarGroupLabel>Workspace</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton
                  render={
                    <a
                      href="https://app.featbit.co/en/workspace/projects"
                      target="_blank"
                      rel="noopener noreferrer"
                    />
                  }
                >
                  <FolderOpen className="size-4" />
                  <span>Projects</span>
                  <ExternalLink className="size-3 ml-auto opacity-50" />
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter>
        <UserMenu />
      </SidebarFooter>
    </Sidebar>
  );
}
