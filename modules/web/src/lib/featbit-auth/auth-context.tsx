"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
} from "react";
import { authStorage } from "./storage";
import { userService } from "./user-service";
import { identityService } from "./identity-service";
import { projectService } from "./project-service";
import { millisecondsUntilExpiry } from "./jwt";
import { refreshAccessToken, SESSION_EXPIRED_EVENT } from "./http";
import type {
  Environment,
  Organization,
  Profile,
  Project,
  ProjectEnv,
  Workspace,
} from "./types";

interface PersistedAuth {
  isAuthenticated: boolean;
  token: string | null;
  profile: Profile | null;
  workspace: Workspace | null;
  organization: Organization | null;
  projectEnv: ProjectEnv | null;
}

export type SessionStatus = "unknown" | "checking" | "valid" | "invalid";

interface AuthContextValue extends PersistedAuth {
  isReady: boolean;
  sessionStatus: SessionStatus;
  organizations: Organization[];
  projects: Project[];
  currentProject: Project | null;
  currentEnvironment: Environment | null;
  completeLogin: (token: string) => Promise<Profile>;
  logout: () => Promise<void>;
  selectOrganization: (org: Organization) => Promise<void>;
  selectProjectEnv: (projectId: string, envId: string) => void;
}

const emptyState: PersistedAuth = {
  isAuthenticated: false,
  token: null,
  profile: null,
  workspace: null,
  organization: null,
  projectEnv: null,
};

const listeners = new Set<() => void>();
let cachedSnapshot: PersistedAuth = emptyState;
let cacheVersion = -1;
let currentVersion = 0;

function computeSnapshot(): PersistedAuth {
  const token = authStorage.getToken();
  if (!token) return emptyState;
  return {
    isAuthenticated: true,
    token,
    profile: authStorage.getProfile(),
    workspace: authStorage.getWorkspace(),
    organization: authStorage.getOrganization(),
    projectEnv: authStorage.getProjectEnv(),
  };
}

function getSnapshot(): PersistedAuth {
  if (cacheVersion !== currentVersion) {
    cachedSnapshot = computeSnapshot();
    cacheVersion = currentVersion;
  }
  return cachedSnapshot;
}

function notifyAuthChange() {
  currentVersion += 1;
  listeners.forEach((l) => l());
}

function subscribe(onChange: () => void) {
  listeners.add(onChange);
  const handleStorage = () => {
    currentVersion += 1;
    onChange();
  };
  if (typeof window !== "undefined") {
    window.addEventListener("storage", handleStorage);
  }
  return () => {
    listeners.delete(onChange);
    if (typeof window !== "undefined") {
      window.removeEventListener("storage", handleStorage);
    }
  };
}

// ── Auto-refresh scheduler (module singleton) ────────────────────────────────
// Fires 30 seconds before the access token expires; retry cadence capped to 60s
// so a long-running tab with clock drift still attempts refreshes.

let refreshTimer: ReturnType<typeof setTimeout> | null = null;

function cancelScheduledRefresh() {
  if (refreshTimer) {
    clearTimeout(refreshTimer);
    refreshTimer = null;
  }
}

function scheduleNextRefresh() {
  cancelScheduledRefresh();
  if (typeof window === "undefined") return;
  const token = authStorage.getToken();
  if (!token) return;
  const msUntilExp = millisecondsUntilExpiry(token);
  const refreshIn = Math.max(1_000, msUntilExp - 30_000);
  refreshTimer = setTimeout(async () => {
    refreshTimer = null;
    const ok = await refreshAccessToken();
    if (ok) {
      notifyAuthChange();
      scheduleNextRefresh();
    }
    // If not ok, we don't clear the token here. The next authenticated request
    // will 401 and go through the http.ts retry + event flow.
  }, refreshIn);
}

function toProjectEnv(project: Project, env: Environment): ProjectEnv {
  return {
    projectId: project.id,
    projectName: project.name,
    projectKey: project.key,
    envId: env.id,
    envKey: env.key,
    envName: env.name,
  };
}

function pickProjectEnv(
  projects: Project[],
  stored: ProjectEnv | null,
): ProjectEnv | null {
  if (projects.length === 0) return null;
  if (stored) {
    const project = projects.find((p) => p.id === stored.projectId);
    const env = project?.environments.find((e) => e.id === stored.envId);
    if (project && env) return toProjectEnv(project, env);
  }
  const first = projects[0];
  const firstEnv = first.environments?.[0];
  return firstEnv ? toProjectEnv(first, firstEnv) : null;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const state = useSyncExternalStore(subscribe, getSnapshot, () => emptyState);
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [sessionStatus, setSessionStatus] = useState<SessionStatus>("unknown");
  const isReady = typeof window !== "undefined";

  const currentProject = useMemo(
    () => projects.find((p) => p.id === state.projectEnv?.projectId) ?? null,
    [projects, state.projectEnv],
  );
  const currentEnvironment = useMemo(
    () =>
      currentProject?.environments.find(
        (e) => e.id === state.projectEnv?.envId,
      ) ?? null,
    [currentProject, state.projectEnv],
  );

  const refreshProjects = useCallback(async () => {
    try {
      const list = await projectService.getProjects();
      setProjects(list);
      const stored = authStorage.getProjectEnv();
      const next = pickProjectEnv(list, stored);
      authStorage.setProjectEnv(next);
      notifyAuthChange();
    } catch {
      setProjects([]);
    }
  }, []);

  useEffect(() => {
    if (!state.isAuthenticated) {
      cancelScheduledRefresh();
      setSessionStatus("invalid");
      return;
    }

    // First-time validation per tab: confirm the stored token still works.
    if (sessionStatus === "unknown" || sessionStatus === "checking") {
      setSessionStatus("checking");
      userService
        .getProfile()
        .then((profile) => {
          if (profile) authStorage.setProfile(profile);
          setSessionStatus("valid");
        })
        .catch(() => {
          setSessionStatus("invalid");
        });
      return;
    }

    if (sessionStatus !== "valid") return;

    if (organizations.length === 0) {
      userService
        .getOrganizations(false)
        .then((list) => setOrganizations(list))
        .catch(() => setOrganizations([]));
    }
    if (projects.length === 0) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      void refreshProjects();
    }
    scheduleNextRefresh();
  }, [
    state.isAuthenticated,
    state.token,
    sessionStatus,
    organizations.length,
    projects.length,
    refreshProjects,
  ]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const handler = () => {
      cancelScheduledRefresh();
      authStorage.clearAll();
      setSessionStatus("invalid");
      notifyAuthChange();
    };
    window.addEventListener(SESSION_EXPIRED_EVENT, handler);
    return () => window.removeEventListener(SESSION_EXPIRED_EVENT, handler);
  }, []);

  const completeLogin = useCallback(
    async (token: string): Promise<Profile> => {
      authStorage.setToken(token);
      const profile = await userService.getProfile();
      authStorage.setProfile(profile);

      try {
        const workspace = await userService.getWorkspace();
        if (workspace) authStorage.setWorkspace(workspace);
      } catch {
        /* optional */
      }

      let orgs: Organization[] = [];
      try {
        orgs = await userService.getOrganizations(false);
        const stored = authStorage.getOrganization();
        const organization =
          orgs.find((o) => o.id === stored?.id) || orgs[0] || null;
        if (organization) authStorage.setOrganization(organization);
      } catch {
        orgs = [];
      }
      setOrganizations(orgs);

      await refreshProjects();
      notifyAuthChange();
      scheduleNextRefresh();
      setSessionStatus("valid");
      return profile;
    },
    [refreshProjects],
  );

  const logout = useCallback(async () => {
    cancelScheduledRefresh();
    try {
      await identityService.logout();
    } catch {
      /* ignore */
    }
    authStorage.clearAll();
    setOrganizations([]);
    setProjects([]);
    notifyAuthChange();
  }, []);

  const selectOrganization = useCallback(
    async (org: Organization) => {
      authStorage.setOrganization(org);
      authStorage.setProjectEnv(null);
      notifyAuthChange();
      await refreshProjects();
    },
    [refreshProjects],
  );

  const selectProjectEnv = useCallback(
    (projectId: string, envId: string) => {
      const project = projects.find((p) => p.id === projectId);
      const env = project?.environments.find((e) => e.id === envId);
      if (!project || !env) return;
      authStorage.setProjectEnv(toProjectEnv(project, env));
      notifyAuthChange();
    },
    [projects],
  );

  const value = useMemo<AuthContextValue>(
    () => ({
      ...state,
      isReady,
      sessionStatus,
      organizations,
      projects,
      currentProject,
      currentEnvironment,
      completeLogin,
      logout,
      selectOrganization,
      selectProjectEnv,
    }),
    [
      state,
      isReady,
      sessionStatus,
      organizations,
      projects,
      currentProject,
      currentEnvironment,
      completeLogin,
      logout,
      selectOrganization,
      selectProjectEnv,
    ],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within an AuthProvider");
  return ctx;
}
