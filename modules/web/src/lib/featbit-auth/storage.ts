import type { Organization, Profile, Workspace } from "./types";

export const STORAGE_KEYS = {
  token: "token",
  profile: "auth",
  workspace: "current-workspace",
  organization: "current-organization",
  loginRedirectUrl: "login-redirect-url",
  isSsoFirstLogin: "is-sso-first-login",
  ssoWorkspaceKey: "sso-workspace-key",
} as const;

function isBrowser() {
  return typeof window !== "undefined";
}

function read<T>(key: string): T | null {
  if (!isBrowser()) return null;
  const raw = window.localStorage.getItem(key);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return raw as unknown as T;
  }
}

function write(key: string, value: unknown) {
  if (!isBrowser()) return;
  if (value === null || value === undefined) {
    window.localStorage.removeItem(key);
    return;
  }
  const serialized = typeof value === "string" ? value : JSON.stringify(value);
  window.localStorage.setItem(key, serialized);
}

export const authStorage = {
  getToken(): string | null {
    if (!isBrowser()) return null;
    return window.localStorage.getItem(STORAGE_KEYS.token);
  },
  setToken(token: string) {
    write(STORAGE_KEYS.token, token);
  },
  getProfile(): Profile | null {
    return read<Profile>(STORAGE_KEYS.profile);
  },
  setProfile(profile: Profile) {
    write(STORAGE_KEYS.profile, profile);
  },
  getWorkspace(): Workspace | null {
    return read<Workspace>(STORAGE_KEYS.workspace);
  },
  setWorkspace(workspace: Workspace) {
    write(STORAGE_KEYS.workspace, workspace);
  },
  getOrganization(): Organization | null {
    return read<Organization>(STORAGE_KEYS.organization);
  },
  setOrganization(org: Organization) {
    write(STORAGE_KEYS.organization, org);
  },
  getLoginRedirectUrl(): string | null {
    if (!isBrowser()) return null;
    return window.localStorage.getItem(STORAGE_KEYS.loginRedirectUrl);
  },
  setLoginRedirectUrl(url: string) {
    write(STORAGE_KEYS.loginRedirectUrl, url);
  },
  clearLoginRedirectUrl() {
    if (!isBrowser()) return;
    window.localStorage.removeItem(STORAGE_KEYS.loginRedirectUrl);
  },
  setSsoFirstLogin(flag: boolean) {
    write(STORAGE_KEYS.isSsoFirstLogin, flag);
  },
  setSsoWorkspaceKey(key: string) {
    write(STORAGE_KEYS.ssoWorkspaceKey, key);
  },
  getSsoWorkspaceKey(): string | null {
    if (!isBrowser()) return null;
    return window.localStorage.getItem(STORAGE_KEYS.ssoWorkspaceKey);
  },
  clearAll() {
    if (!isBrowser()) return;
    Object.values(STORAGE_KEYS).forEach((k) =>
      window.localStorage.removeItem(k),
    );
  },
};
