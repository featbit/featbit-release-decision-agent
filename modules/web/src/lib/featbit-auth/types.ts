export enum UserOrigin {
  Local = "Local",
  Sso = "Sso",
  OAuth = "OAuth",
}

export enum OAuthProviderName {
  GitHub = "GitHub",
  Google = "Google",
}

export interface Profile {
  id: string;
  email: string;
  name: string;
  workspaceId: string;
  origin: UserOrigin;
}

export interface LoginToken {
  token: string;
  isSsoFirstLogin: boolean;
}

export interface OAuthProvider {
  name: OAuthProviderName | string;
  authorizeUrl: string;
  icon?: string;
}

export interface SsoPreCheck {
  isEnabled: boolean;
  workspaceKey?: string;
}

export interface Workspace {
  id: string;
  name: string;
  key: string;
}

export interface Organization {
  id: string;
  name: string;
  key: string;
  initialized: boolean;
}

export interface ApiEnvelope<T> {
  success: boolean;
  errors?: string[];
  data?: T;
}
