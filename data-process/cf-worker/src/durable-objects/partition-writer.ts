/**
 * PartitionWriterDO
 *
 * Owns a single partition: (table, envId, key, date).
 * Buffers incoming events in memory, durably persists to DO Storage every 5s,
 * and writes an aggregated delta file to R2 every 10 minutes.
 *
 * DO Storage keys:
 *   "cfg"              → PartitionConfig (set once on first request)
 *   "lastDelta"        → number  (ms timestamp of last R2 delta write)
 *   "buf:{ts}-{i}"     → JSON string of up to CHUNK_SIZE records
 */

import type { Env } from "../env";
import type {
  PartitionConfig,
  FlagEvalRecord,
  MetricEventRecord,
  FlagEvalEntry,
  MetricEntry,
} from "../models/types";
import {
  flagEvalDeltaKey,
  metricEventDeltaKey,
} from "../storage/path-helper";

const MEM_FLUSH_SIZE    = 200;           // flush memory → storage if this many events queued
const CHUNK_SIZE        = 50;            // events per storage key (keeps each value < 128 KB)
const MINI_ALARM_MS     = 5_000;         // alarm interval for memory → storage flush
const DELTA_INTERVAL_MS = 10 * 60_000;  // write R2 delta every 10 minutes

export class PartitionWriterDO implements DurableObject {
  private memBuffer: (FlagEvalRecord | MetricEventRecord)[] = [];
  private alarmScheduled = false;

  constructor(
    private readonly state: DurableObjectState,
    private readonly env: Env,
  ) {}

  // ── HTTP interface ──────────────────────────────────────────────────────────

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    // Dev-only: force immediate delta flush to R2
    if (url.pathname === "/flush" && request.method === "POST") {
      await this.flushMemToStorage();
      const cfg = await this.state.storage.get<PartitionConfig>("cfg");
      if (cfg) await this.writeDeltaToR2(cfg);
      await this.state.storage.put("lastDelta", Date.now());
      return new Response("flushed", { status: 200 });
    }

    const body = await request.json() as {
      config: PartitionConfig;
      records: (FlagEvalRecord | MetricEventRecord)[];
    };

    // Persist config on first request
    if (!(await this.state.storage.get<PartitionConfig>("cfg"))) {
      await this.state.storage.put("cfg", body.config);
    }

    for (const r of body.records) this.memBuffer.push(r);

    if (this.memBuffer.length >= MEM_FLUSH_SIZE) {
      await this.flushMemToStorage();
    }

    if (!this.alarmScheduled) {
      await this.state.storage.setAlarm(Date.now() + MINI_ALARM_MS);
      this.alarmScheduled = true;
    }

    return new Response("ok", { status: 202 });
  }

  // ── Alarm handler ───────────────────────────────────────────────────────────

  async alarm(): Promise<void> {
    this.alarmScheduled = false;

    await this.flushMemToStorage();

    const lastDelta = (await this.state.storage.get<number>("lastDelta")) ?? 0;
    const now       = Date.now();

    if (now - lastDelta >= DELTA_INTERVAL_MS) {
      const cfg = await this.state.storage.get<PartitionConfig>("cfg");
      if (cfg) {
        const wrote = await this.writeDeltaToR2(cfg);
        if (wrote) await this.state.storage.put("lastDelta", now);
      }
    }

    // Keep alarm alive as long as there is buffered data or next delta is due
    const hasBuf    = (await this.state.storage.list({ prefix: "buf:", limit: 1 })).size > 0;
    const nextDelta = (await this.state.storage.get<number>("lastDelta") ?? 0) + DELTA_INTERVAL_MS;
    if (hasBuf || this.memBuffer.length > 0 || Date.now() < nextDelta) {
      await this.state.storage.setAlarm(Date.now() + MINI_ALARM_MS);
      this.alarmScheduled = true;
    }
  }

  // ── Memory → DO Storage ─────────────────────────────────────────────────────

  private async flushMemToStorage(): Promise<void> {
    if (this.memBuffer.length === 0) return;

    const ts  = Date.now();
    const map = new Map<string, string>();
    for (let i = 0; i < this.memBuffer.length; i += CHUNK_SIZE) {
      map.set(`buf:${ts}-${i}`, JSON.stringify(this.memBuffer.slice(i, i + CHUNK_SIZE)));
    }
    await this.state.storage.put(map as unknown as Record<string, unknown>);
    this.memBuffer = [];
  }

  // ── DO Storage → R2 delta ───────────────────────────────────────────────────

  private async writeDeltaToR2(cfg: PartitionConfig): Promise<boolean> {
    // Read all buf keys (paginate at 128)
    const allKeys:    string[]                               = [];
    const allRecords: (FlagEvalRecord | MetricEventRecord)[] = [];
    let startAfter: string | undefined;

    while (true) {
      const batch = await this.state.storage.list<string>({ prefix: "buf:", startAfter, limit: 128 });
      for (const [k, v] of batch) {
        allKeys.push(k);
        const parsed = JSON.parse(v) as (FlagEvalRecord | MetricEventRecord)[];
        allRecords.push(...parsed);
      }
      if (batch.size < 128) break;
      startAfter = [...batch.keys()].at(-1);
    }

    if (allRecords.length === 0) return false;

    // Aggregate per user
    const u = cfg.table === "flag-eval"
      ? this.aggregateFE(allRecords as FlagEvalRecord[])
      : this.aggregateME(allRecords as MetricEventRecord[]);

    if (Object.keys(u).length === 0) return false;

    // Write delta to R2
    const r2Key = cfg.table === "flag-eval"
      ? flagEvalDeltaKey(cfg.envId, cfg.key, cfg.date, Date.now())
      : metricEventDeltaKey(cfg.envId, cfg.key, cfg.date, Date.now());

    await this.env.TSDB_BUCKET.put(r2Key, JSON.stringify({ v: 1, u }));

    // Delete processed buf keys (batch of 128)
    for (let i = 0; i < allKeys.length; i += 128) {
      await this.state.storage.delete(allKeys.slice(i, i + 128));
    }

    return true;
  }

  // ── Aggregation helpers ─────────────────────────────────────────────────────

  private aggregateFE(records: FlagEvalRecord[]): Record<string, FlagEvalEntry> {
    const result: Record<string, FlagEvalEntry> = {};
    for (const r of records) {
      const ex = result[r.userKey];
      if (!ex || r.timestamp < ex[0]) {
        result[r.userKey] = [r.timestamp, r.variant, r.experimentId, r.layerId, r.hashBucket];
      }
    }
    return result;
  }

  private aggregateME(records: MetricEventRecord[]): Record<string, MetricEntry> {
    const result: Record<string, MetricEntry> = {};
    for (const r of records) {
      const ex = result[r.userKey];
      if (!ex) {
        result[r.userKey] = [
          1,
          r.timestamp, r.numericValue,
          r.timestamp, r.numericValue,
          r.numericValue ?? 0,
          r.numericValue !== null ? 1 : 0,
        ];
      } else {
        if (r.timestamp < ex[1]) { ex[1] = r.timestamp; ex[2] = r.numericValue; }
        if (r.timestamp > ex[3]) { ex[3] = r.timestamp; ex[4] = r.numericValue; }
        if (r.numericValue !== null) { ex[5] += r.numericValue; ex[6]++; }
      }
    }
    return result;
  }
}
