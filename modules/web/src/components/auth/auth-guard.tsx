"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { useAuth } from "@/lib/featbit-auth/auth-context";
import { authStorage } from "@/lib/featbit-auth/storage";

function ConnectingSplash({ message }: { message: string }) {
  return (
    <div className="flex h-dvh w-full items-center justify-center bg-muted/30">
      <div className="flex flex-col items-center gap-4 text-center">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/logo.svg" alt="FeatBit" className="size-12 shadow-sm" />
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" />
          <span>{message}</span>
        </div>
      </div>
    </div>
  );
}

export function AuthGuard({ children }: { children: React.ReactNode }) {
  const { isReady, isAuthenticated, sessionStatus } = useAuth();
  const router = useRouter();
  const pathname = usePathname();

  // Defer all auth-derived rendering until after the client has mounted so
  // that SSR and the first client render agree (both show "Loading…"),
  // preventing a hydration mismatch when useAuth resolves synchronously
  // from localStorage.
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setMounted(true);
  }, []);

  const shouldRedirectToLogin =
    isReady && (!isAuthenticated || sessionStatus === "invalid");

  useEffect(() => {
    if (!shouldRedirectToLogin) return;
    if (typeof window !== "undefined") {
      const target = `${pathname}${window.location.search || ""}`;
      if (target && target !== "/login") {
        authStorage.setLoginRedirectUrl(target);
      }
    }
    router.replace("/login");
  }, [shouldRedirectToLogin, pathname, router]);

  if (!mounted || !isReady) {
    return <ConnectingSplash message="Loading…" />;
  }
  if (shouldRedirectToLogin) {
    return <ConnectingSplash message="Redirecting to sign-in…" />;
  }
  if (sessionStatus === "checking" || sessionStatus === "unknown") {
    return <ConnectingSplash message="Moving into your target space..." />;
  }

  return <>{children}</>;
}
