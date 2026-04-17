import { apiRequest } from "./http";
import type { LoginToken, SsoPreCheck } from "./types";

export const ssoService = {
  preCheck() {
    return apiRequest<SsoPreCheck>("/sso/pre-check", {
      method: "GET",
      skipAuth: true,
    });
  },
  getAuthorizeUrl(workspaceKey: string, redirectUri: string) {
    return apiRequest<string>("/sso/oidc-authorize-url", {
      method: "GET",
      query: { redirect_uri: redirectUri, workspace_key: workspaceKey },
      skipAuth: true,
      raw: true,
    });
  },
  oidcLogin(code: string, workspaceKey: string, redirectUri: string) {
    return apiRequest<LoginToken>("/sso/oidc/login", {
      method: "POST",
      body: { code, redirectUri, workspaceKey },
      skipAuth: true,
    });
  },
};
