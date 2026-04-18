import { SidebarProvider } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/app-sidebar";
import { AuthShell } from "@/components/auth/auth-shell";
import { WorkspaceSwitcher } from "@/components/workspace/workspace-switcher";

export const dynamic = "force-dynamic";

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <AuthShell>
      <SidebarProvider>
        <div className="flex h-full w-full">
          <AppSidebar />
          <main className="flex-1 overflow-auto flex flex-col">
            <header className="sticky top-0 z-10 flex h-11 shrink-0 items-center justify-end gap-2 border-b border-border/60 bg-background/80 px-4 backdrop-blur">
              <WorkspaceSwitcher />
            </header>
            <div className="flex-1">{children}</div>
          </main>
        </div>
      </SidebarProvider>
    </AuthShell>
  );
}
