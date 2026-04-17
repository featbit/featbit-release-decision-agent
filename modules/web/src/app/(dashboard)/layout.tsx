import { SidebarProvider } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/app-sidebar";
import { AuthShell } from "@/components/auth/auth-shell";

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
          <main className="flex-1 overflow-auto">{children}</main>
        </div>
      </SidebarProvider>
    </AuthShell>
  );
}
