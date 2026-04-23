/**
 * Mint env secrets matching track-service's EnvSecretMiddleware:
 *
 *   fbes.<b64url(envId)>.<b64url(HMAC-SHA256(envId, KEY)[0..16])>
 *
 * Uses Web Crypto (SubtleCrypto) so the same code runs under Cloudflare Workers
 * and Node 20+ (where globalThis.crypto is the Web Crypto API).
 */

const TOKEN_PREFIX = "fbes.";
const SIG_BYTES = 16;

const encoder = new TextEncoder();

function toBase64Url(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export async function signEnvSecret(
  envId: string,
  signingKey: string | undefined,
): Promise<string> {
  if (!envId) throw new Error("envId is required");
  // No signing key → legacy mode: the raw envId is the Authorization value.
  if (!signingKey) return envId;

  const envIdBytes = encoder.encode(envId);
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(signingKey),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sigBuf = await crypto.subtle.sign("HMAC", key, envIdBytes);
  const sig = new Uint8Array(sigBuf).subarray(0, SIG_BYTES);
  return `${TOKEN_PREFIX}${toBase64Url(envIdBytes)}.${toBase64Url(sig)}`;
}
