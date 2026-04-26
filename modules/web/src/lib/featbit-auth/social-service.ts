import { apiRequest } from "./http";
import type { LoginToken, OAuthProvider, Profile } from "./types";

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

export const socialService = {
  getProviders(redirectUri: string) {
    // Pre-login: hits the proxy without a session — proxy forwards as-is.
    return apiRequest<OAuthProvider[]>("/social/providers", {
      method: "GET",
      query: { redirectUri },
    });
  },
  async login(
    code: string,
    providerName: string,
    redirectUri: string,
  ): Promise<LoginToken> {
    const result = await postLocal<ExchangeResponse>("/api/auth/social-exchange", {
      code,
      providerName,
      redirectUri,
    });
    return { token: "session", isSsoFirstLogin: result.isSsoFirstLogin };
  },
};
