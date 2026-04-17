import { AuthProvider } from "@/lib/featbit-auth/auth-context";

export const dynamic = "force-dynamic";

export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <AuthProvider>
      <div className="flex min-h-dvh w-full items-center justify-center bg-muted/30 px-4 py-12">
        {children}
      </div>
    </AuthProvider>
  );
}
