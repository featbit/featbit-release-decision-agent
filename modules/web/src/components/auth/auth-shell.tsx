"use client";

import { AuthProvider } from "@/lib/featbit-auth/auth-context";
import { AuthGuard } from "./auth-guard";

export function AuthShell({ children }: { children: React.ReactNode }) {
  return (
    <AuthProvider>
      <AuthGuard>{children}</AuthGuard>
    </AuthProvider>
  );
}
