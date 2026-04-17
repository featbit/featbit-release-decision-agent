import { apiRequest } from "./http";
import type { LoginToken } from "./types";

export const identityService = {
  loginByEmail(email: string, password: string, workspaceKey?: string) {
    return apiRequest<LoginToken>("/identity/login-by-email", {
      method: "POST",
      body: { email, password, workspaceKey },
      skipAuth: true,
    });
  },
  refreshToken() {
    return apiRequest<LoginToken>("/identity/refresh-token", {
      method: "POST",
      skipAuth: true,
    });
  },
  logout() {
    return apiRequest<boolean>("/identity/logout", {
      method: "POST",
    }).catch(() => false);
  },
};
