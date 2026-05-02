/**
 * Data access layer for Customer Managed Data Endpoint providers.
 *
 * Public contract:  docs/customer-managed-data-endpoints-v1.md
 * Implementation:   docs/customer-managed-endpoints-implementation.md
 *
 * Secrets:
 *   - signingSecret is auto-generated on create / rotate. Clients never
 *     supply it. The full value is returned ONCE in the create / rotate
 *     response and never again — list / get responses always carry the
 *     masked form via maskSecret().
 *   - secondarySecret holds the previous primary during a rotation grace
 *     window. Customers may accept either; FeatBit always signs with the
 *     primary (signingSecret).
 */

import { randomBytes } from "node:crypto";
import { prisma } from "@/lib/prisma";
import type { CustomerEndpointProvider } from "@/generated/prisma";

// ── Public DTO shapes ─────────────────────────────────────────────────────────

/**
 * Safe shape for list / get responses. The signingSecret is replaced with a
 * masked preview; the secondarySecret is only flagged as present, not echoed.
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

/**
 * Returned ONCE from create / rotate so the operator can copy the secret
 * into their endpoint config. Never persisted in any log or echoed again.
 */
export interface ProviderWithSecret extends ProviderPublic {
  signingSecretPlaintext:   string;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Generate a signing secret. 32 bytes of CSPRNG → base64url. Prefixed
 * `fbsk_` so the kind of token is obvious in logs and config files.
 */
function generateSecret(): string {
  return `fbsk_${randomBytes(32).toString("base64url")}`;
}

/**
 * Mask a stored secret for safe display. Shows the prefix + last 4 chars only.
 *   "fbsk_aBcDeFgHiJ…XyZ1" → "fbsk_••••XyZ1"
 */
export function maskSecret(secret: string): string {
  if (!secret) return "";
  const last4 = secret.slice(-4);
  const prefix = secret.startsWith("fbsk_") ? "fbsk_" : "";
  return `${prefix}••••${last4}`;
}

/**
 * Validate a base URL. Must be HTTPS, must parse, no trailing slash on path.
 * SSRF protection (rejecting private/loopback IPs) is deferred to PR 4 where
 * the actual outbound fetch happens; defence-in-depth check there is the
 * authoritative guard.
 */
export function validateBaseUrl(input: string): { ok: true; normalized: string } | { ok: false; error: string } {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    return { ok: false, error: "baseUrl must be a valid URL" };
  }
  if (url.protocol !== "https:") {
    return { ok: false, error: "baseUrl must use https://" };
  }
  // Strip trailing slash so concatenation with per-endpoint path is unambiguous.
  const normalized = url.toString().replace(/\/$/, "");
  return { ok: true, normalized };
}

function toPublic(row: CustomerEndpointProvider): ProviderPublic {
  return {
    id:                  row.id,
    projectKey:          row.projectKey,
    name:                row.name,
    baseUrl:             row.baseUrl,
    signingSecretMasked: maskSecret(row.signingSecret),
    hasSecondarySecret:  row.secondarySecret !== null,
    schemaVersion:       row.schemaVersion,
    timeoutMs:           row.timeoutMs,
    createdAt:           row.createdAt.toISOString(),
    updatedAt:           row.updatedAt.toISOString(),
  };
}

function toWithSecret(row: CustomerEndpointProvider): ProviderWithSecret {
  return { ...toPublic(row), signingSecretPlaintext: row.signingSecret };
}

// ── Public API ────────────────────────────────────────────────────────────────

export async function listProviders(projectKey: string): Promise<ProviderPublic[]> {
  const rows = await prisma.customerEndpointProvider.findMany({
    where: { projectKey },
    orderBy: { createdAt: "asc" },
  });
  return rows.map(toPublic);
}

export async function getProvider(projectKey: string, id: string): Promise<ProviderPublic | null> {
  const row = await prisma.customerEndpointProvider.findUnique({ where: { id } });
  if (!row || row.projectKey !== projectKey) return null;
  return toPublic(row);
}

export interface CreateProviderInput {
  name:       string;
  baseUrl:    string;
  timeoutMs?: number;
}

export async function createProvider(
  projectKey: string,
  input: CreateProviderInput,
): Promise<ProviderWithSecret> {
  const row = await prisma.customerEndpointProvider.create({
    data: {
      projectKey,
      name:          input.name,
      baseUrl:       input.baseUrl,
      signingSecret: generateSecret(),
      timeoutMs:     input.timeoutMs ?? 15000,
    },
  });
  return toWithSecret(row);
}

export interface UpdateProviderInput {
  name?:      string;
  baseUrl?:   string;
  timeoutMs?: number;
}

export async function updateProvider(
  projectKey: string,
  id: string,
  input: UpdateProviderInput,
): Promise<ProviderPublic | null> {
  const existing = await prisma.customerEndpointProvider.findUnique({ where: { id } });
  if (!existing || existing.projectKey !== projectKey) return null;
  const row = await prisma.customerEndpointProvider.update({
    where: { id },
    data: {
      ...(input.name      !== undefined && { name:      input.name }),
      ...(input.baseUrl   !== undefined && { baseUrl:   input.baseUrl }),
      ...(input.timeoutMs !== undefined && { timeoutMs: input.timeoutMs }),
    },
  });
  return toPublic(row);
}

/**
 * Rotate the primary signing secret. Old primary moves to `secondarySecret`
 * so customer endpoints can accept either during a grace window. A second
 * call to rotateSecret() drops whatever was in secondarySecret and replaces
 * it with the now-old primary.
 *
 * Returns the new primary in plaintext ONCE — caller must surface it to the
 * operator for copy-paste into the customer endpoint config.
 */
export async function rotateSecret(
  projectKey: string,
  id: string,
): Promise<ProviderWithSecret | null> {
  const existing = await prisma.customerEndpointProvider.findUnique({ where: { id } });
  if (!existing || existing.projectKey !== projectKey) return null;
  const row = await prisma.customerEndpointProvider.update({
    where: { id },
    data: {
      signingSecret:   generateSecret(),
      secondarySecret: existing.signingSecret,
    },
  });
  return toWithSecret(row);
}

/**
 * Promote secondary into primary slot, clear secondary. Used when the
 * grace window for a rotation is over and the customer has confirmed they
 * are no longer using the old secret.
 *
 * No-op (returns provider unchanged) when secondarySecret is null.
 */
export async function clearSecondarySecret(
  projectKey: string,
  id: string,
): Promise<ProviderPublic | null> {
  const existing = await prisma.customerEndpointProvider.findUnique({ where: { id } });
  if (!existing || existing.projectKey !== projectKey) return null;
  if (existing.secondarySecret === null) return toPublic(existing);
  const row = await prisma.customerEndpointProvider.update({
    where: { id },
    data:  { secondarySecret: null },
  });
  return toPublic(row);
}

export async function deleteProvider(projectKey: string, id: string): Promise<boolean> {
  const existing = await prisma.customerEndpointProvider.findUnique({ where: { id } });
  if (!existing || existing.projectKey !== projectKey) return false;
  // Referential check (any ExperimentRun.customerEndpointConfig pointing here)
  // is deferred — the JSON column makes the query awkward and PR 5 will need
  // to handle "endpoint disappeared" gracefully anyway.
  await prisma.customerEndpointProvider.delete({ where: { id } });
  return true;
}
