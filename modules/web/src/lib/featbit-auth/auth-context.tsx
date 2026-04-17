"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  useSyncExternalStore,
} from "react";
import { authStorage } from "./storage";
import { userService } from "./user-service";
import { identityService } from "./identity-service";
import type { Organization, Profile, Workspace } from "./types";

interface PersistedAuth {
  isAuthenticated: boolean;
  token: string | null;
  profile: Profile | null;
  workspace: Workspace | null;
  organization: Organization | null;
}

interface AuthContextValue extends PersistedAuth {
  isReady: boolean;
  organizations: Organization[];
  completeLogin: (token: string) => Promise<Profile>;
  logout: () => Promise<void>;
  selectOrganization: (org: Organization) => void;
}

const emptyState: PersistedAuth = {
  isAuthenticated: false,
  token: null,
  profile: null,
  workspace: null,
  organization: null,
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

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const state = useSyncExternalStore(subscribe, getSnapshot, () => emptyState);
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const isReady = typeof window !== "undefined";

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
      notifyAuthChange();
      return profile;
    },
    [],
  );

  const logout = useCallback(async () => {
    try {
      await identityService.logout();
    } catch {
      /* ignore */
    }
    authStorage.clearAll();
    setOrganizations([]);
    notifyAuthChange();
  }, []);

  const selectOrganization = useCallback((org: Organization) => {
    authStorage.setOrganization(org);
    notifyAuthChange();
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      ...state,
      isReady,
      organizations,
      completeLogin,
      logout,
      selectOrganization,
    }),
    [state, isReady, organizations, completeLogin, logout, selectOrganization],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within an AuthProvider");
  return ctx;
}
