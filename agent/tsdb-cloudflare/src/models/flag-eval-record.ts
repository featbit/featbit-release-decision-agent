/** One flag evaluation event (exposure record). */
export interface FlagEvalRecord {
  envId: string;
  flagKey: string;
  userKey: string;
  variant: string;
  experimentId: string | null;
  layerId: string | null;
  sessionId: string | null;
  timestamp: number; // unix ms
  hashBucket: number; // 0-99
  userPropsJson: string | null;
}

/** Compute a deterministic hash bucket for traffic splitting: FNV-1a(userKey + flagKey) % 100. */
export function computeHashBucket(userKey: string, flagKey: string): number {
  const str = userKey + flagKey;
  let hash = 0x811c9dc5; // FNV offset basis (32-bit)
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193); // FNV prime
  }
  return Math.abs(hash) % 100;
}

export function createFlagEvalRecord(
  envId: string,
  flagKey: string,
  userKey: string,
  variant: string,
  timestampMs: number,
  experimentId?: string | null,
  layerId?: string | null,
  userProps?: Record<string, string> | null,
): FlagEvalRecord {
  return {
    envId,
    flagKey,
    userKey,
    variant,
    experimentId: experimentId ?? null,
    layerId: layerId ?? null,
    sessionId: null,
    timestamp: timestampMs,
    hashBucket: computeHashBucket(userKey, flagKey),
    userPropsJson: userProps ? JSON.stringify(userProps) : null,
  };
}
