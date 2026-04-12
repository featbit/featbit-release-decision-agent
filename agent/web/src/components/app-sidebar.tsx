import Link from "next/link";
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
  SidebarFooter,
} from "@/components/ui/sidebar";
import { getExperiments } from "@/lib/data";
import { FolderKanban, FlaskConical, Plus } from "lucide-react";

export async function AppSidebar() {
  const experiments = await getExperiments();

  return (
    <Sidebar>
      <SidebarHeader>
        <div className="flex items-center gap-2 px-2 py-1">
          <FlaskConical className="size-5" />
          <span className="font-semibold text-sm">Release Decision</span>
        </div>
      </SidebarHeader>
      <SidebarContent>
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
          <SidebarGroupLabel>Recent</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {experiments.slice(0, 10).map((experiment) => (
                <SidebarMenuItem key={experiment.id}>
                  <SidebarMenuButton render={<Link href={`/experiments/${experiment.id}`} />}>
                    <span className="truncate">{experiment.name}</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter>
        <div className="px-2 py-1 text-xs text-muted-foreground">
          FeatBit Release Decision Agent
        </div>
      </SidebarFooter>
    </Sidebar>
  );
}
