/**
 * FNV-1a 32-bit hash — fast, no dependencies, sufficient for bloom filters
 * and hash-bucket computation. Not cryptographic.
 */
export function fnv1a32(data: Uint8Array): number {
  let hash = 0x811c9dc5; // FNV offset basis
  for (let i = 0; i < data.length; i++) {
    hash ^= data[i];
    hash = Math.imul(hash, 0x01000193); // FNV prime
  }
  return hash >>> 0; // ensure unsigned
}

/** FNV-1a on a string (UTF-8 encoded). */
export function fnv1aStr(s: string): number {
  return fnv1a32(new TextEncoder().encode(s));
}

/** Deterministic hash for balanced sampling: same purpose as .NET XxHash3 for Balance(). */
export function hashForBalance(userKey: string): number {
  return fnv1aStr(userKey);
}
