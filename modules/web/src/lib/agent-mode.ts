"use client";

import { useCallback, useSyncExternalStore } from "react";

/**
 * Two ways to drive the agent chat:
 *  - "managed": FeatBit-hosted Claude (sandbox0 Managed Agents)
 *  - "local":   the user's own Claude Code CLI, fronted by
 *               `@featbit/experimentation-claude-code-connector` on
 *               http://127.0.0.1:3100
 *
 * The choice is per-browser (localStorage), not per-deployment, since the
 * web app is a hosted multi-tenant service and each user picks for
 * themselves.
 */
export type AgentMode = "managed" | "local";

const STORAGE_KEY = "featbit:agent-mode";
const MODE_CHANGE_EVENT = "featbit:agent-mode-change";

export const DEFAULT_AGENT_MODE: AgentMode = "managed";

function parseMode(raw: string | null | undefined): AgentMode {
  return raw === "local" || raw === "managed" ? raw : DEFAULT_AGENT_MODE;
}

export function readAgentMode(): AgentMode {
  if (typeof window === "undefined") return DEFAULT_AGENT_MODE;
  return parseMode(window.localStorage.getItem(STORAGE_KEY));
}

export function writeAgentMode(mode: AgentMode): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(STORAGE_KEY, mode);
  // Notify same-tab listeners; the native `storage` event only fires
  // across tabs, not within the same one.
  window.dispatchEvent(new CustomEvent(MODE_CHANGE_EVENT, { detail: mode }));
}

function subscribe(onChange: () => void): () => void {
  window.addEventListener(MODE_CHANGE_EVENT, onChange);
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener(MODE_CHANGE_EVENT, onChange);
    window.removeEventListener("storage", onChange);
  };
}

/**
 * React hook that reads the current mode and re-renders when it changes
 * (in this tab via `writeAgentMode`, or in another tab via the browser's
 * native `storage` event). Uses `useSyncExternalStore` so server snapshots
 * are stable and there is no setState-in-effect hydration dance.
 */
export function useAgentMode(): [AgentMode, (next: AgentMode) => void] {
  const mode = useSyncExternalStore(subscribe, readAgentMode, () => DEFAULT_AGENT_MODE);

  const update = useCallback((next: AgentMode) => {
    writeAgentMode(next);
  }, []);

  return [mode, update];
}
