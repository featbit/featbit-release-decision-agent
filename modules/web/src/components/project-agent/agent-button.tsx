"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Sparkles, Minus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { useAuth } from "@/lib/featbit-auth/auth-context";
import { AgentChat } from "./agent-chat";

// ── Cookie helpers (keyed by user id) ───────────────────────────────────────

function cookieKey(userId: string) {
  return `pa_onboarded_${userId}`;
}

function hasOnboardingCookie(userId: string): boolean {
  if (typeof document === "undefined") return false;
  return document.cookie
    .split(";")
    .some((c) => c.trim().startsWith(cookieKey(userId) + "="));
}

function markOnboarded(userId: string) {
  document.cookie = `${cookieKey(userId)}=1; path=/; max-age=${365 * 24 * 60 * 60}; SameSite=Lax`;
}

// ── Component ────────────────────────────────────────────────────────────────

/**
 * Right-side drawer (70 % viewport width) hosting project-agent chat.
 *
 * Bootstrap / auto-open:
 *  When BOTH conditions hold the drawer opens automatically and sends the
 *  session-start prompt:
 *    1. No onboarding cookie for this user id  (first time on this browser)
 *    2. Memory pool has no entries             (agent has no prior context)
 *  The cookie is keyed per user (not per project) so one completion covers all
 *  projects for that user. Once either condition breaks, no auto-open.
 */
export function AgentButton() {
  const { profile, currentProject, isReady } = useAuth();
  const [open, setOpen] = useState(false);
  const [minimized, setMinimized] = useState(false);
  const [hasMemory, setHasMemory] = useState<boolean | null>(null);
  const autoOpenFiredRef = useRef(false);
  // Stays true only until the first bootstrap completes; prevents re-bootstrap
  // when the drawer is closed and reopened (AgentChat unmounts/remounts).
  const bootstrapDoneRef = useRef(false);

  const handleBootstrapComplete = useCallback(() => {
    bootstrapDoneRef.current = true;
  }, []);

  const projectKey = currentProject?.key ?? null;
  const userId = profile?.id ?? null;

  // Probe memory once after auth is ready.
  useEffect(() => {
    if (!isReady || !projectKey) return;
    let cancelled = false;
    fetch(`/api/memory/project/${encodeURIComponent(projectKey)}`)
      .then((r) => (r.ok ? r.json() : []))
      .then((entries) => {
        if (!cancelled) setHasMemory((entries as unknown[]).length > 0);
      })
      .catch(() => {
        if (!cancelled) setHasMemory(true); // fail-closed: don't auto-open on errors
      });
    return () => { cancelled = true; };
  }, [isReady, projectKey]);

  // needsBootstrap is a live derived value — only true before cookie is set.
  const needsBootstrap =
    userId !== null &&
    hasMemory === false &&
    !hasOnboardingCookie(userId);

  // Auto-open once when the first-time conditions hold.
  useEffect(() => {
    if (!needsBootstrap) return;
    if (autoOpenFiredRef.current) return;
    autoOpenFiredRef.current = true;
    markOnboarded(userId!); // write cookie so refresh doesn't re-trigger
    setOpen(true);
  }, [needsBootstrap, userId]);

  function openDrawer() {
    setMinimized(false);
    setOpen(true);
  }

  return (
    <>
      {/* Nav bar trigger */}
      <Button
        variant="ghost"
        size="sm"
        className="h-8 gap-1.5 text-xs"
        onClick={openDrawer}
      >
        <Sparkles className="size-3.5" />
        <span className="hidden sm:inline">Ask project-agent</span>
        {needsBootstrap && (
          <span className="ml-1 size-1.5 rounded-full bg-brand" aria-hidden />
        )}
      </Button>

      {/* Drawer — 70 % viewport width */}
      <Sheet
        open={open && !minimized}
        onOpenChange={(v) => { if (!v) setOpen(false); }}
      >
        <SheetContent
          side="right"
          showCloseButton={false}
          style={{ width: "70vw", maxWidth: "70vw" }}
          className="flex flex-col p-0 gap-0"
        >
          <SheetHeader className="shrink-0 border-b px-4 py-3 flex flex-row items-center justify-between space-y-0">
            <div>
              <SheetTitle className="flex items-center gap-2 text-sm">
                <Sparkles className="size-4 text-brand" />
                project-agent
              </SheetTitle>
              <SheetDescription className="text-xs mt-0.5">
                {projectKey
                  ? `Scoped to ${currentProject?.name ?? projectKey}`
                  : "Select a project to start."}
              </SheetDescription>
            </div>
            <div className="flex items-center gap-0.5">
              <Button
                variant="ghost"
                size="icon"
                className="size-7 shrink-0"
                onClick={() => setMinimized(true)}
                title="Minimize"
              >
                <Minus className="size-3.5" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="size-7 shrink-0"
                onClick={() => setOpen(false)}
                title="Close"
              >
                <X className="size-3.5" />
              </Button>
            </div>
          </SheetHeader>

          {open && (
            <AgentChat
              projectKey={projectKey}
              userId={userId}
              autoBootstrap={!bootstrapDoneRef.current}
              onBootstrapComplete={handleBootstrapComplete}
            />
          )}
        </SheetContent>
      </Sheet>

      {/* Floating pill when minimized */}
      {minimized && open && (
        <button
          onClick={() => { setMinimized(false); }}
          className="fixed bottom-4 right-4 z-50 flex items-center gap-2 rounded-full bg-foreground px-4 py-2.5 text-sm font-medium text-background shadow-lg hover:opacity-90 transition-opacity"
        >
          <Sparkles className="size-3.5" />
          project-agent
        </button>
      )}
    </>
  );
}
