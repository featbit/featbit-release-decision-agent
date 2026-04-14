import type { Env } from "../env";
import type { TrackPayload, FlagEvalRecord, MetricEventRecord, PartitionConfig } from "../models/types";
import { sanitize, toDateString, computeHashBucket } from "../storage/path-helper";

interface PartitionBatch {
  config: PartitionConfig;
  records: (FlagEvalRecord | MetricEventRecord)[];
}

export async function handleTrack(request: Request, env: Env): Promise<Response> {
  // Optional bearer auth
  if (env.TRACK_SECRET) {
    const auth = request.headers.get("Authorization");
    if (auth !== `Bearer ${env.TRACK_SECRET}`) {
      return new Response("Unauthorized", { status: 401 });
    }
  }

  // envId comes from Authorization header (same as existing convention)
  const envId = request.headers.get("Authorization") ?? "unknown";

  let payloads: TrackPayload[];
  try {
    payloads = await request.json() as TrackPayload[];
  } catch {
    return new Response("Invalid JSON", { status: 400 });
  }

  if (!Array.isArray(payloads) || payloads.length === 0) {
    return new Response("Empty payload", { status: 400 });
  }

  // Group by partition key
  const partitions = new Map<string, PartitionBatch>();

  for (const payload of payloads) {
    const userKey = payload.user.keyId;

    // Flag evaluations
    for (const v of payload.variations ?? []) {
      const tsMs   = v.timestamp * 1000;
      const date   = toDateString(tsMs);
      const partKey = `fe:${sanitize(envId)}:${sanitize(v.flagKey)}:${date}`;

      if (!partitions.has(partKey)) {
        partitions.set(partKey, {
          config: { table: "flag-eval", envId, key: v.flagKey, date },
          records: [],
        });
      }

      partitions.get(partKey)!.records.push({
        envId,
        flagKey:      v.flagKey,
        userKey,
        variant:      v.variant,
        timestamp:    tsMs,
        experimentId: v.experimentId ?? null,
        layerId:      v.layerId      ?? null,
        hashBucket:   computeHashBucket(userKey, v.flagKey),
      } satisfies FlagEvalRecord);
    }

    // Metric events
    for (const m of payload.metrics ?? []) {
      const tsMs   = m.timestamp * 1000;
      const date   = toDateString(tsMs);
      const partKey = `me:${sanitize(envId)}:${sanitize(m.eventName)}:${date}`;

      if (!partitions.has(partKey)) {
        partitions.set(partKey, {
          config: { table: "metric-event", envId, key: m.eventName, date },
          records: [],
        });
      }

      partitions.get(partKey)!.records.push({
        envId,
        eventName:    m.eventName,
        userKey,
        numericValue: m.numericValue ?? null,
        timestamp:    tsMs,
      } satisfies MetricEventRecord);
    }
  }

  // Dispatch each partition batch to its DO
  await Promise.all(
    [...partitions.entries()].map(async ([partKey, batch]) => {
      const doId = env.PARTITION_WRITER.idFromName(partKey);
      const stub = env.PARTITION_WRITER.get(doId);
      await stub.fetch("https://do/ingest", {
        method: "POST",
        body:   JSON.stringify(batch),
        headers: { "Content-Type": "application/json" },
      });
    }),
  );

  return new Response("OK", { status: 202 });
}
