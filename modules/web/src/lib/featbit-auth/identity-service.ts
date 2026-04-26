import type { LoginToken, Profile } from "./types";

interface LoginResponse {
  profile: Profile;
  isSsoFirstLogin: boolean;
}

async function postLocal<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let parsed: unknown = null;
  if (text) {
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = null;
    }
  }
  if (!res.ok) {
    const message =
      (parsed as { error?: string } | null)?.error ?? `${res.status} ${res.statusText}`;
    throw new Error(message);
  }
  return parsed as T;
}

export const identityService = {
  /**
   * Server-side login: trades email/password for an opaque session cookie.
   * The shape mirrors the legacy LoginToken to keep callers unchanged — but
   * the token is no longer exposed to the browser.
   */
  async loginByEmail(
    email: string,
    password: string,
    workspaceKey?: string,
  ): Promise<LoginToken> {
    const result = await postLocal<LoginResponse>("/api/auth/login", {
      email,
      password,
      workspaceKey,
    });
    return { token: "session", isSsoFirstLogin: result.isSsoFirstLogin };
  },
  async logout(): Promise<boolean> {
    try {
      await postLocal<{ ok: boolean }>("/api/auth/logout");
      return true;
    } catch {
      return false;
    }
  },
};
