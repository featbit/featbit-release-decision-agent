import { apiRequest } from "./http";
import type { LoginToken, OAuthProvider } from "./types";

export const socialService = {
  getProviders(redirectUri: string) {
    return apiRequest<OAuthProvider[]>("/social/providers", {
      method: "GET",
      query: { redirectUri },
      skipAuth: true,
    });
  },
  login(code: string, providerName: string, redirectUri: string) {
    return apiRequest<LoginToken>("/social/login", {
      method: "POST",
      body: { code, providerName, redirectUri },
      skipAuth: true,
    });
  },
};
