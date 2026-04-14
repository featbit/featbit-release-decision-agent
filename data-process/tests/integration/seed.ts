/**
 * seed.ts — generate synthetic users with deterministic assignments.
 *
 * Uses the same computeHashBucket() as the cf-worker so we know exactly
 * which variant each user gets, enabling precise expected values.
 */

import { CFG } from "./config.ts";
import type { TrackPayload } from "./types.ts";

/** Mirror of cf-worker's computeHashBucket */
function computeHashBucket(userKey: string, flagKey: string): number {
  const input = `${userKey}:${flagKey}`;
  let h = 0;
  for (let i = 0; i < input.length; i++) {
    h = (Math.imul(31, h) + input.charCodeAt(i)) >>> 0;
  }
  return h % 100;
}

export interface SeedData {
  payloads: TrackPayload[];
  expected: {
    variantA: { users: number; conversions: number; convRate: number };
    variantB: { users: number; conversions: number; convRate: number };
  };
}

export function generateSeedData(seed = 42): SeedData {
  const nowSec = Math.floor(Date.now() / 1000);  // epoch seconds for TrackPayload
  const payloads: TrackPayload[] = [];

  let aUsers = 0, bUsers = 0, aConv = 0, bConv = 0;

  // Simple LCG PRNG
  let rngState = seed;
  function nextRng(): number {
    rngState = (rngState * 1664525 + 1013904223) >>> 0;
    return rngState / 0xFFFF_FFFF;
  }

  for (let i = 0; i < CFG.userCount; i++) {
    const userKey    = `user-${i.toString().padStart(6, "0")}`;
    const hashBucket = computeHashBucket(userKey, CFG.flagKey);
    const variant    = hashBucket < 50 ? CFG.variantA : CFG.variantB;
    const tsEval     = nowSec - (CFG.userCount - i);  // spread evals over ~16 min

    if (variant === CFG.variantA) aUsers++;
    else                          bUsers++;

    const payload: TrackPayload = {
      user: { keyId: userKey },
      variations: [{
        flagKey:      CFG.flagKey,
        variant,
        timestamp:    tsEval,
        experimentId: CFG.experimentId,
      }],
    };

    // Deterministic conversion
    const rate = variant === CFG.variantB ? CFG.conversionRate : CFG.baseConversionRate;
    if (nextRng() < rate) {
      payload.metrics = [{
        eventName: CFG.metricEvent,
        timestamp: tsEval + Math.floor(nextRng() * 3_600),  // within 1h of eval
      }];
      if (variant === CFG.variantA) aConv++;
      else                          bConv++;
    }

    payloads.push(payload);
  }

  return {
    payloads,
    expected: {
      variantA: { users: aUsers, conversions: aConv, convRate: aConv / aUsers },
      variantB: { users: bUsers, conversions: bConv, convRate: bConv / bUsers },
    },
  };
}
