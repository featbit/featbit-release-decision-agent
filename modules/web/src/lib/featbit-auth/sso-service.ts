import { apiRequest } from "./http";
import type { LoginToken, Profile, SsoPreCheck } from "./types";

interface ExchangeResponse {
  profile: Profile;
  isSsoFirstLogin: boolean;
}

async function postLocal<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(path, {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
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

export const ssoService = {
  preCheck() {
    return apiRequest<SsoPreCheck>("/sso/pre-check", { method: "GET" });
  },
  getAuthorizeUrl(workspaceKey: string, redirectUri: string) {
    return apiRequest<string>("/sso/oidc-authorize-url", {
      method: "GET",
      query: { redirect_uri: redirectUri, workspace_key: workspaceKey },
      raw: true,
    });
  },
  async oidcLogin(
    code: string,
    workspaceKey: string,
    redirectUri: string,
  ): Promise<LoginToken> {
    const result = await postLocal<ExchangeResponse>("/api/auth/sso-exchange", {
      code,
      workspaceKey,
      redirectUri,
    });
    return { token: "session", isSsoFirstLogin: result.isSsoFirstLogin };
  },
};
