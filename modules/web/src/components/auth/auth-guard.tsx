"use client";

import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { useAuth } from "@/lib/featbit-auth/auth-context";
import { authStorage } from "@/lib/featbit-auth/storage";

export function AuthGuard({ children }: { children: React.ReactNode }) {
  const { isReady, isAuthenticated } = useAuth();
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (!isReady) return;
    if (!isAuthenticated) {
      if (typeof window !== "undefined") {
        const target = `${pathname}${window.location.search || ""}`;
        if (target && target !== "/login") {
          authStorage.setLoginRedirectUrl(target);
        }
      }
      router.replace("/login");
    }
  }, [isReady, isAuthenticated, pathname, router]);

  if (!isReady || !isAuthenticated) {
    return (
      <div className="flex h-dvh w-full items-center justify-center">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" />
          <span>Checking your session…</span>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
