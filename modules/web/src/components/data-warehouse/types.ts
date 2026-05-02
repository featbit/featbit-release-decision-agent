/**
 * Client-side mirror of the DTOs returned by
 * /api/projects/[projectKey]/customer-endpoints. Kept here to avoid pulling
 * server-only modules (`@/lib/customer-endpoint-providers`) into client
 * bundles.
 */

export interface ProviderPublic {
  id:                       string;
  projectKey:               string;
  name:                     string;
  baseUrl:                  string;
  signingSecretMasked:      string;
  hasSecondarySecret:       boolean;
  schemaVersion:            number;
  timeoutMs:                number;
  createdAt:                string;
  updatedAt:                string;
}

export interface ProviderWithSecret extends ProviderPublic {
  signingSecretPlaintext:   string;
}
