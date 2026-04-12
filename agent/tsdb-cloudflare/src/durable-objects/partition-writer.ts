/**
 * Durable Object that buffers incoming records and flushes them as
 * immutable segment files to R2.
 *
 * Flush triggers (whichever comes first):
 *   - Batch reaches MAX_BATCH_SIZE (10 000 records).
 *   - FLUSH_INTERVAL_MS (500 ms) alarm fires.
 *
 * Each DO instance owns a single partition: (table, envId, key, date).
 * The partition prefix and table type are set via the first request.
 *
 * Naming convention: the DO id is derived from the partition key string
 * so the Worker can deterministically route records.
 */

import type { Env } from "../env";
import {
  writeFlagEvalSegment,
  writeMetricEventSegment,
} from "../storage/segment-writer";
import { FILE_EXTENSION } from "../storage/segment-format";
import type { FlagEvalRecord } from "../models/flag-eval-record";
import type { MetricEventRecord } from "../models/metric-event-record";

const MAX_BATCH_SIZE = 10_000;
const FLUSH_INTERVAL_MS = 500;

interface PartitionConfig {
  /** R2 key prefix, e.g. "flag-evals/env123/my-flag/2025-01-15/" */
  prefix: string;
  /** "flag-eval" or "metric-event" */
  table: "flag-eval" | "metric-event";
}

export class PartitionWriterDO implements DurableObject {
  private buffer: (FlagEvalRecord | MetricEventRecord)[] = [];
  private config: PartitionConfig | null = null;
  private segmentCounter = 0;
  private alarmSet = false;

  constructor(
    private readonly state: DurableObjectState,
    private readonly env: Env,
  ) {}

  // ── HTTP interface (called by Worker fetch handler) ─────────────────────────

  async fetch(request: Request): Promise<Response> {
    const body = (await request.json()) as {
      config: PartitionConfig;
      records: (FlagEvalRecord | MetricEventRecord)[];
    };

    // First call establishes partition identity
    if (!this.config) {
      this.config = body.config;
      this.segmentCounter = await this.scanMaxSegment();
    }

    // Buffer records
    for (const r of body.records) {
      this.buffer.push(r);
    }

    // Batch-size trigger
    if (this.buffer.length >= MAX_BATCH_SIZE) {
      await this.flush();
    } else if (!this.alarmSet) {
      // Schedule alarm for time-based flush
      this.state.storage.setAlarm(Date.now() + FLUSH_INTERVAL_MS);
      this.alarmSet = true;
    }

    return new Response("ok", { status: 202 });
  }

  // ── Alarm handler ───────────────────────────────────────────────────────────

  async alarm(): Promise<void> {
    this.alarmSet = false;
    if (this.buffer.length > 0) {
      await this.flush();
    }
  }

  // ── Flush ───────────────────────────────────────────────────────────────────

  private async flush(): Promise<void> {
    if (!this.config || this.buffer.length === 0) return;

    const batch = this.buffer;
    this.buffer = [];
    this.alarmSet = false;

    this.segmentCounter++;
    const seq = String(this.segmentCounter).padStart(8, "0");
    const key = `${this.config.prefix}seg-${seq}${FILE_EXTENSION}`;

    const result =
      this.config.table === "flag-eval"
        ? await writeFlagEvalSegment(batch as FlagEvalRecord[])
        : await writeMetricEventSegment(batch as MetricEventRecord[]);

    // Store segment on R2 with header in custom metadata for header-free pruning
    await this.env.TSDB_BUCKET.put(key, result.data.buffer as ArrayBuffer, {
      customMetadata: {
        "seg-header": JSON.stringify(result.header),
      },
    });
  }

  // ── Helpers ─────────────────────────────────────────────────────────────────

  /**
   * Scan R2 for existing segment files under this partition prefix
   * so the counter resumes from the correct sequence number.
   */
  private async scanMaxSegment(): Promise<number> {
    if (!this.config) return 0;

    let max = 0;
    let cursor: string | undefined;

    do {
      const list = await this.env.TSDB_BUCKET.list({
        prefix: this.config.prefix,
        cursor,
      });

      for (const obj of list.objects) {
        const name = obj.key.split("/").pop() ?? "";
        if (name.startsWith("seg-") && name.endsWith(FILE_EXTENSION)) {
          const numStr = name.slice(4, name.length - FILE_EXTENSION.length);
          const n = parseInt(numStr, 10);
          if (n > max) max = n;
        }
      }

      cursor = list.truncated ? list.cursor : undefined;
    } while (cursor);

    return max;
  }
}
