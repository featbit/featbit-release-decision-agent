/**
 * POST /api/track — Ingest flag evaluations and metric events.
 *
 * Parses TrackPayload[], converts DTOs to internal records, and routes each
 * record to the correct PartitionWriterDO based on (table, envId, key, date).
 */

import type { Env } from "../env";
import type { TrackPayload } from "../models/dtos";
import {
  createFlagEvalRecord,
  computeHashBucket,
} from "../models/flag-eval-record";
import { createMetricEventRecord } from "../models/metric-event-record";
import type { FlagEvalRecord } from "../models/flag-eval-record";
import type { MetricEventRecord } from "../models/metric-event-record";
import { flagEvalPrefix, metricEventPrefix } from "../storage/path-helper";

interface PartitionBatch {
  prefix: string;
  table: "flag-eval" | "metric-event";
  records: (FlagEvalRecord | MetricEventRecord)[];
}

export async function handleTrack(
  request: Request,
  env: Env,
): Promise<Response> {
  // Validate Authorization header.
  const envSecret = request.headers.get("Authorization");
  if (!envSecret) {
    return new Response("Missing Authorization header", { status: 401 });
  }
  const envId = envSecret; // envSecret = envId in this system

  const payloads: TrackPayload[] = await request.json();
  if (!Array.isArray(payloads) || payloads.length === 0) {
    return new Response("Empty payload", { status: 400 });
  }

  // Group records by partition key → (table, envId, key, date).
  const partitions = new Map<string, PartitionBatch>();

  for (const payload of payloads) {
    const userKey = payload.user.keyId;
    const userProps =
      payload.user.properties && Object.keys(payload.user.properties).length > 0
        ? payload.user.properties
        : null;

    // Flag evaluations.
    if (payload.variations) {
      for (const v of payload.variations) {
        const tsMs = v.timestamp * 1000; // SDK sends seconds → convert to ms
        const dateStr = toDateString(tsMs);
        const prefix = flagEvalPrefix(envId, v.flagKey, dateStr);
        const partKey = `fe:${prefix}`;

        let batch = partitions.get(partKey);
        if (!batch) {
          batch = { prefix, table: "flag-eval", records: [] };
          partitions.set(partKey, batch);
        }

        batch.records.push(
          createFlagEvalRecord(
            envId,
            v.flagKey,
            userKey,
            v.variant,
            tsMs,
            v.experimentId ?? null,
            v.layerId ?? null,
            userProps,
          ),
        );
      }
    }

    // Metric events.
    if (payload.metrics) {
      for (const m of payload.metrics) {
        const tsMs = m.timestamp * 1000;
        const dateStr = toDateString(tsMs);
        const prefix = metricEventPrefix(envId, m.eventName, dateStr);
        const partKey = `me:${prefix}`;

        let batch = partitions.get(partKey);
        if (!batch) {
          batch = { prefix, table: "metric-event", records: [] };
          partitions.set(partKey, batch);
        }

        batch.records.push(
          createMetricEventRecord(
            envId,
            m.eventName,
            userKey,
            tsMs,
            m.numericValue,
            m.type ?? null,
          ),
        );
      }
    }
  }

  // Dispatch each partition batch to its Durable Object.
  const dispatches = [...partitions.entries()].map(
    async ([partKey, batch]) => {
      const doId = env.PARTITION_WRITER.idFromName(partKey);
      const stub = env.PARTITION_WRITER.get(doId);
      await stub.fetch("https://do/ingest", {
        method: "POST",
        body: JSON.stringify({
          config: { prefix: batch.prefix, table: batch.table },
          records: batch.records,
        }),
      });
    },
  );

  await Promise.all(dispatches);

  return new Response("OK", { status: 202 });
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function toDateString(tsMs: number): string {
  return new Date(tsMs).toISOString().slice(0, 10);
}
