#!/usr/bin/env npx tsx
/**
 * Incremental compaction benchmark against real R2 data.
 *
 * 测试场景（接续 bench-r2-compact.ts 跑完的全量 rollup）：
 *
 *   Run A — 从头增量（checkpoint=0，处理全部 2000 个 segment）
 *            对比基准：和全量 compact 的 173s 比较
 *
 *   Run B — 无新数据（checkpoint=2000）
 *            验证：当没有新 segment 时几乎零耗时
 *
 *   Run C — 模拟 1000 个新 segment（强制 checkpoint=1000）
 *            模拟：运行一段时间后的典型增量场景
 *
 * Required env vars: R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY
 */

import { createHmac, createHash } from "node:crypto";
import { incrementalCompact, writeCheckpoint } from "../src/rollup/incremental-compact";
import type { CompactCheckpoint } from "../src/rollup/incremental-compact";
import { writeFlagEvalSegment, writeMetricEventSegment } from "../src/storage/segment-writer";
import { computeHashBucket } from "../src/models/flag-eval-record";
import { flagEvalPrefix, metricEventPrefix } from "../src/storage/path-helper";
import type { FlagEvalRecord } from "../src/models/flag-eval-record";
import type { MetricEventRecord } from "../src/models/metric-event-record";

// ── Config（与 seed-r2.ts 保持一致）──────────────────────────────────────────

const BUCKET          = "featbit-tsdb";
const ENV_ID          = "c93f1a2b-3d4e-5f6a-7b8c-9d0e1f2a3b4c";
const FLAG_KEY        = "pricing-redesign-2026";
const METRIC_EVENT    = "checkout_completed";
const DATE            = "2026-04-13";
const EXPERIMENT_ID   = "b47e3e12-9f2a-4c1b-8d3e-2a1f5c6b7d8e";
const UNIQUE_USERS    = 20_000;
const RECORDS_PER_SEG = 5_000;
const VARIANTS        = ["control", "treatment"] as const;

// ── AWS SigV4（复用 bench-r2-compact.ts 的实现）──────────────────────────────

function sha256hex(data: string | Buffer): string {
  return createHash("sha256").update(data).digest("hex");
}
function hmac256(key: string | Buffer, data: string): Buffer {
  return createHmac("sha256", key).update(data).digest();
}
function getSigningKey(secret: string, date: string, region: string, service: string): Buffer {
  return hmac256(hmac256(hmac256(hmac256("AWS4" + secret, date), region), service), "aws4_request");
}
function authHeader(opts: {
  method: string; path: string; host: string;
  dateTime: string; date: string; contentHash: string;
  accessKeyId: string; secretKey: string;
}): string {
  const sh = "content-type;host;x-amz-content-sha256;x-amz-date";
  const cr = [
    opts.method, opts.path, "",
    `content-type:application/octet-stream\nhost:${opts.host}\nx-amz-content-sha256:${opts.contentHash}\nx-amz-date:${opts.dateTime}\n`,
    sh, opts.contentHash,
  ].join("\n");
  const scope = `${opts.date}/auto/s3/aws4_request`;
  const sts   = ["AWS4-HMAC-SHA256", opts.dateTime, scope, sha256hex(cr)].join("\n");
  const sig   = hmac256(getSigningKey(opts.secretKey, opts.date, "auto", "s3"), sts).toString("hex");
  return `AWS4-HMAC-SHA256 Credential=${opts.accessKeyId}/${scope}, SignedHeaders=${sh}, Signature=${sig}`;
}

// ── Real R2 client ────────────────────────────────────────────────────────────

interface Creds { accountId: string; accessKeyId: string; secretKey: string }

function nowParts() {
  const now      = new Date();
  const dateTime = now.toISOString().replace(/[-:]|\.\d{3}/g, "").slice(0, 15) + "Z";
  return { dateTime, date: dateTime.slice(0, 8) };
}

class RealR2Bucket {
  private readonly host: string;

  constructor(private readonly creds: Creds, private readonly bucket: string) {
    this.host = `${creds.accountId}.r2.cloudflarestorage.com`;
  }

  private enc(key: string): string {
    return key.split("/").map(encodeURIComponent).join("/");
  }

  private hdrs(method: string, path: string, body: Buffer) {
    const { dateTime, date } = nowParts();
    const contentHash = sha256hex(body);
    return {
      "content-type":         "application/octet-stream",
      "x-amz-date":           dateTime,
      "x-amz-content-sha256": contentHash,
      "authorization": authHeader({
        method, path, host: this.host, dateTime, date, contentHash,
        accessKeyId: this.creds.accessKeyId, secretKey: this.creds.secretKey,
      }),
    };
  }

  async get(key: string, retries = 4) {
    const path = `/${this.bucket}/${this.enc(key)}`;
    for (let attempt = 0; attempt <= retries; attempt++) {
      if (attempt > 0) await new Promise(r => setTimeout(r, 100 * attempt));
      try {
        const res = await fetch(`https://${this.host}${path}`, {
          method: "GET", headers: this.hdrs("GET", path, Buffer.alloc(0)),
        });
        if (res.status === 404) return null;
        if (!res.ok) throw new Error(`R2 GET ${key}: HTTP ${res.status}`);
        const buf = await res.arrayBuffer();
        return {
          arrayBuffer: () => Promise.resolve(buf),
          json:        <T>() => Promise.resolve(JSON.parse(new TextDecoder().decode(buf))) as Promise<T>,
        };
      } catch (err) {
        const isSocket = (err as NodeJS.ErrnoException).code === "UND_ERR_SOCKET";
        if (attempt < retries && isSocket) continue;
        throw err;
      }
    }
    throw new Error(`R2 GET ${key}: exhausted retries`);
  }

  async head(key: string) {
    const path = `/${this.bucket}/${this.enc(key)}`;
    const res  = await fetch(`https://${this.host}${path}`, {
      method: "HEAD", headers: this.hdrs("HEAD", path, Buffer.alloc(0)),
    });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`R2 HEAD ${key}: HTTP ${res.status}`);
    return { key };
  }

  async put(key: string, value: ArrayBuffer | string) {
    const data = typeof value === "string"
      ? Buffer.from(value, "utf8")
      : Buffer.from(value);
    const path = `/${this.bucket}/${this.enc(key)}`;
    const res  = await fetch(`https://${this.host}${path}`, {
      method: "PUT", headers: this.hdrs("PUT", path, data), body: data,
    });
    if (!res.ok) throw new Error(`R2 PUT ${key}: HTTP ${res.status}`);
  }

  async list(opts?: { prefix?: string; cursor?: string; delimiter?: string }) {
    const raw: [string, string][] = [["list-type", "2"]];
    if (opts?.prefix)    raw.push(["prefix",             opts.prefix]);
    if (opts?.delimiter) raw.push(["delimiter",          opts.delimiter]);
    if (opts?.cursor)    raw.push(["continuation-token", opts.cursor]);
    raw.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
    const qs = raw.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join("&");

    const path = `/${this.bucket}`;
    const { dateTime, date } = nowParts();
    const contentHash = sha256hex(Buffer.alloc(0));
    const sh    = "host;x-amz-content-sha256;x-amz-date";
    const cr    = ["GET", path, qs, `host:${this.host}\nx-amz-content-sha256:${contentHash}\nx-amz-date:${dateTime}\n`, sh, contentHash].join("\n");
    const scope = `${date}/auto/s3/aws4_request`;
    const sts   = ["AWS4-HMAC-SHA256", dateTime, scope, sha256hex(cr)].join("\n");
    const sig   = hmac256(getSigningKey(this.creds.secretKey, date, "auto", "s3"), sts).toString("hex");
    const auth  = `AWS4-HMAC-SHA256 Credential=${this.creds.accessKeyId}/${scope}, SignedHeaders=${sh}, Signature=${sig}`;

    const res = await fetch(`https://${this.host}${path}?${qs}`, {
      headers: { "host": this.host, "x-amz-date": dateTime, "x-amz-content-sha256": contentHash, "authorization": auth },
    });
    if (!res.ok) throw new Error(`R2 LIST: HTTP ${res.status} ${await res.text()}`);

    const xml = await res.text();
    const objects: { key: string }[] = [];
    for (const m of xml.matchAll(/<Key>([^<]+)<\/Key>/g)) objects.push({ key: decodeURIComponent(m[1]) });

    const truncated   = /<IsTruncated>true<\/IsTruncated>/.test(xml);
    const cursorMatch = xml.match(/<NextContinuationToken>([^<]+)<\/NextContinuationToken>/);
    return {
      objects,
      truncated,
      cursor:            truncated ? (cursorMatch?.[1] ?? undefined) : undefined,
      delimitedPrefixes: [] as string[],
    };
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtMs(ms: number): string {
  return ms < 1000 ? `${ms.toFixed(0)}ms` : `${(ms / 1000).toFixed(2)}s`;
}
function hr()  { console.log("─".repeat(64)); }
function banner(t: string) { console.log("═".repeat(64)); console.log(`  ${t}`); console.log("═".repeat(64)); }

// ── 数据生成 + 上传（Run D 专用）─────────────────────────────────────────────

async function seedNewSegments(
  rawBucket: RealR2Bucket,
  fromSeq: number,
  count: number,
): Promise<void> {
  const userPool  = Array.from({ length: UNIQUE_USERS }, (_, i) => `user-${String(i).padStart(6, "0")}`);
  const dayStart  = new Date(`${DATE}T00:00:00Z`).getTime();
  const msPerSeg  = Math.floor(86_400_000 / (fromSeq + count));
  const fePrefix  = flagEvalPrefix(ENV_ID, FLAG_KEY, DATE);
  const mePrefix  = metricEventPrefix(ENV_ID, METRIC_EVENT, DATE);

  console.log(`  生成并上传 seq ${fromSeq + 1} → ${fromSeq + count} ...`);

  for (let s = 0; s < count; s++) {
    const seq     = fromSeq + s + 1;
    const seqStr  = String(seq).padStart(8, "0");
    const baseTs  = dayStart + seq * msPerSeg;

    // flag-eval
    const feRecs: FlagEvalRecord[] = Array.from({ length: RECORDS_PER_SEG }, (_, i) => {
      const uk = userPool[(Math.random() * UNIQUE_USERS) | 0];
      return {
        envId: ENV_ID, flagKey: FLAG_KEY, userKey: uk,
        variant: VARIANTS[(Math.random() * 2) | 0],
        experimentId: EXPERIMENT_ID, layerId: null, sessionId: null,
        timestamp: baseTs + i * 17,
        hashBucket: computeHashBucket(uk, FLAG_KEY),
        userPropsJson: null,
      };
    });
    const feResult = await writeFlagEvalSegment(feRecs);
    await rawBucket.put(`${fePrefix}seg-${seqStr}.fbs`, feResult.data.buffer as ArrayBuffer);

    // metric-event
    const meRecs: MetricEventRecord[] = Array.from({ length: RECORDS_PER_SEG }, (_, i) => ({
      envId: ENV_ID, eventName: METRIC_EVENT,
      userKey: userPool[(Math.random() * UNIQUE_USERS) | 0],
      numericValue: Math.round((10 + Math.random() * 190) * 100) / 100,
      timestamp: baseTs + i * 17 + 30_000,
      sessionId: null, source: null,
    }));
    const meResult = await writeMetricEventSegment(meRecs);
    await rawBucket.put(`${mePrefix}seg-${seqStr}.fbs`, meResult.data.buffer as ArrayBuffer);

    if ((s + 1) % 50 === 0 || s === count - 1) {
      process.stdout.write(`    [${s + 1}/${count}] seq=${seq}\n`);
    }
  }
}

// ── 本地聚合（Run E 专用，纯内存不写 R2）────────────────────────────────────

/**
 * 在本地生成 count 个 FE segment 的数据并聚合（每用户保留最早 exposure）。
 * 不写 R2，纯内存。返回 Record<userKey, [ts, variant, expId, layerId, hashBucket]>
 */
async function localAggregateFlagEval(
  count: number,
  baseSeq: number,
): Promise<Record<string, unknown[]>> {
  const userPool = Array.from({ length: UNIQUE_USERS }, (_, i) => `user-${String(i).padStart(6, "0")}`);
  const dayStart = new Date(`${DATE}T00:00:00Z`).getTime();
  const msPerSeg = Math.floor(86_400_000 / (baseSeq + count));
  const result: Record<string, unknown[]> = {};

  for (let s = 0; s < count; s++) {
    const seq    = baseSeq + s + 1;
    const baseTs = dayStart + seq * msPerSeg;

    for (let i = 0; i < RECORDS_PER_SEG; i++) {
      const uk      = userPool[(Math.random() * UNIQUE_USERS) | 0];
      const ts      = baseTs + i * 17;
      const variant = VARIANTS[(Math.random() * 2) | 0];
      const hb      = computeHashBucket(uk, FLAG_KEY);
      const ex      = result[uk] as number[] | undefined;
      if (!ex || ts < ex[0]) {
        result[uk] = [ts, variant, EXPERIMENT_ID, null, hb];
      }
    }
  }
  return result;
}

/**
 * 在本地生成 count 个 ME segment 的数据并聚合（每用户累计 sum/count/firstTs/latestTs）。
 * 不写 R2，纯内存。返回 Record<userKey, [hasConv, firstTs, firstVal, latestTs, latestVal, sum, count]>
 */
async function localAggregateMetricEvent(
  count: number,
  baseSeq: number,
): Promise<Record<string, unknown[]>> {
  const userPool = Array.from({ length: UNIQUE_USERS }, (_, i) => `user-${String(i).padStart(6, "0")}`);
  const dayStart = new Date(`${DATE}T00:00:00Z`).getTime();
  const msPerSeg = Math.floor(86_400_000 / (baseSeq + count));
  const result: Record<string, unknown[]> = {};

  for (let s = 0; s < count; s++) {
    const seq    = baseSeq + s + 1;
    const baseTs = dayStart + seq * msPerSeg;

    for (let i = 0; i < RECORDS_PER_SEG; i++) {
      const uk  = userPool[(Math.random() * UNIQUE_USERS) | 0];
      const ts  = baseTs + i * 17 + 30_000;
      const val = Math.round((10 + Math.random() * 190) * 100) / 100;
      const ex  = result[uk] as number[] | undefined;
      if (!ex) {
        // [hasConv, firstTs, firstVal, latestTs, latestVal, sum, count]
        result[uk] = [1, ts, val, ts, val, val, 1];
      } else {
        ex[0] = 1;
        if (ts < ex[1]) { ex[1] = ts; ex[2] = val; }
        if (ts > ex[3]) { ex[3] = ts; ex[4] = val; }
        ex[5] = (ex[5] as number) + val;
        ex[6] = (ex[6] as number) + 1;
      }
    }
  }
  return result;
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const creds: Creds = {
    accountId:   process.env.R2_ACCOUNT_ID        ?? "",
    accessKeyId: process.env.R2_ACCESS_KEY_ID     ?? "",
    secretKey:   process.env.R2_SECRET_ACCESS_KEY ?? "",
  };
  if (!creds.accountId || !creds.accessKeyId || !creds.secretKey) {
    console.error("Missing: R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY");
    process.exit(1);
  }

  const rawBucket = new RealR2Bucket(creds, BUCKET);
  const bucket    = rawBucket as unknown as R2Bucket;

  banner("FeatBit TSDB — Incremental Compact Benchmark (real R2)");
  console.log(`  envId: ${ENV_ID}  flagKey: ${FLAG_KEY}  date: ${DATE}\n`);

  const req    = { envId: ENV_ID, flagKey: FLAG_KEY, metricEvents: [METRIC_EVENT], date: DATE };
  const onlyD  = process.argv.includes("--only-d");
  const onlyE  = process.argv.includes("--only-e");

  if (onlyD || onlyE) {
    const NEW_SEG_COUNT = 200;
    const BASE_SEQ      = 2000;

    if (onlyD) {
      // ── Run D: 当前方案（上传 segment → compact 读回）──────────────────────
      console.log(`Run D — 当前方案：上传 ${NEW_SEG_COUNT} 个 segment 再 compact`);
      hr();

      const cpD: CompactCheckpoint = {
        feLastSeq: BASE_SEQ, meLastSeq: { [METRIC_EVENT]: BASE_SEQ },
        updatedAt: new Date().toISOString(),
      };
      await writeCheckpoint(bucket, ENV_ID, FLAG_KEY, DATE, cpD);

      const dSeedStart = Date.now();
      await seedNewSegments(rawBucket, BASE_SEQ, NEW_SEG_COUNT);
      const dSeedMs = Date.now() - dSeedStart;
      console.log(`  上传耗时: ${fmtMs(dSeedMs)}\n`);

      const rD = await incrementalCompact(bucket, req);
      console.log(`  FE 新 segment: ${rD.feNewSegments}`);
      console.log(`  compact 耗时: ${fmtMs(rD.durationMs)}`);
      console.log(`  D 总耗时: ${fmtMs(dSeedMs + rD.durationMs)}\n`);
    }

    // ── Run E: 新方案（本地聚合 → 直接 merge rollup）────────────────────────
    console.log(`Run E — 新方案：本地聚合 ${NEW_SEG_COUNT} 个 segment，直接 merge rollup`);
    hr();

    const eStart = Date.now();

    // 1. 本地生成并聚合（纯内存，不写 R2）
    const localFERollup = await localAggregateFlagEval(NEW_SEG_COUNT, BASE_SEQ);
    const localMERollup = await localAggregateMetricEvent(NEW_SEG_COUNT, BASE_SEQ);
    const eLocalMs = Date.now() - eStart;
    console.log(`  本地聚合耗时: ${fmtMs(eLocalMs)}  (FE ${Object.keys(localFERollup).length} users, ME ${Object.keys(localMERollup).length} users)`);

    // 2. 读现有 rollup（1 GET each）
    const feRollupKey = `rollups/flag-evals/${ENV_ID}/${FLAG_KEY}/${DATE}.json`;
    const meRollupKey = `rollups/metric-events/${ENV_ID}/${METRIC_EVENT}/${DATE}.json`;
    const eReadStart  = Date.now();
    const feObj = await rawBucket.get(feRollupKey);
    const meObj = await rawBucket.get(meRollupKey);
    const feRollup = feObj ? (JSON.parse(new TextDecoder().decode(await feObj.arrayBuffer())) as { v: 1; u: Record<string, unknown[]> }) : { v: 1 as const, u: {} };
    const meRollup = meObj ? (JSON.parse(new TextDecoder().decode(await meObj.arrayBuffer())) as { v: 1; u: Record<string, unknown[]> }) : { v: 1 as const, u: {} };
    const eReadMs = Date.now() - eReadStart;
    console.log(`  读现有 rollup 耗时: ${fmtMs(eReadMs)}`);

    // 3. Merge（纯内存）
    const eMergeStart = Date.now();
    for (const [uk, entry] of Object.entries(localFERollup)) {
      const ex = feRollup.u[uk] as number[] | undefined;
      if (!ex || (entry[0] as number) < ex[0]) feRollup.u[uk] = entry;
    }
    for (const [uk, entry] of Object.entries(localMERollup)) {
      const ex = meRollup.u[uk] as number[] | undefined;
      if (!ex) {
        meRollup.u[uk] = entry;
      } else {
        // [hasConv, firstTs, firstVal, latestTs, latestVal, sum, count]
        ex[0] = (ex[0] || entry[0]) ? 1 : 0;
        if ((entry[1] as number) < (ex[1] as number)) { ex[1] = entry[1]; ex[2] = entry[2]; }
        if ((entry[3] as number) > (ex[3] as number)) { ex[3] = entry[3]; ex[4] = entry[4]; }
        ex[5] = (ex[5] as number) + (entry[5] as number);
        ex[6] = (ex[6] as number) + (entry[6] as number);
      }
    }
    const eMergeMs = Date.now() - eMergeStart;
    console.log(`  merge 耗时: ${fmtMs(eMergeMs)}`);

    // 4. 写回（1 PUT each）
    const eWriteStart = Date.now();
    await rawBucket.put(feRollupKey, JSON.stringify(feRollup));
    await rawBucket.put(meRollupKey, JSON.stringify(meRollup));
    const eWriteMs = Date.now() - eWriteStart;
    console.log(`  写回 rollup 耗时: ${fmtMs(eWriteMs)}`);

    const eTotalMs = Date.now() - eStart;
    console.log(`  E 总耗时: ${fmtMs(eTotalMs)}\n`);

    // ── 结果 ─────────────────────────────────────────────────────────────────
    banner("Run E 结果（200 个新 segment，本地聚合方案）");
    console.log(`  Run E 新方案    本地聚合+merge: ${fmtMs(eTotalMs)}`);
    console.log(`    本地聚合:     ${fmtMs(eLocalMs)}  (纯内存)`);
    console.log(`    读 rollup:    ${fmtMs(eReadMs)}   (2×GET)`);
    console.log(`    merge+写回:   ${fmtMs(eMergeMs + eWriteMs)}  (2×PUT)`);

    process.exit(0);
  }

  // ── Run A: 从头增量（checkpoint=0，全部 2000 个 segment）──────────────────

  console.log("Run A — 从头增量 (checkpoint=0，处理全部 2000 FE + 2000 ME segments)");
  hr();

  // 清除已有 checkpoint，从 seq=0 开始
  const cpA: CompactCheckpoint = { feLastSeq: 0, meLastSeq: {}, updatedAt: new Date(0).toISOString() };
  await writeCheckpoint(bucket, ENV_ID, FLAG_KEY, DATE, cpA);

  const rA = await incrementalCompact(bucket, req);
  console.log(`  FE 新 segment: ${rA.feNewSegments}  ME 新 segment: ${rA.meNewSegments[METRIC_EVENT] ?? 0}`);
  console.log(`  checkpoint 更新至: FE seq=${rA.checkpoint.feLastSeq}  ME seq=${rA.checkpoint.meLastSeq[METRIC_EVENT]}`);
  console.log(`  耗时: ${fmtMs(rA.durationMs)}\n`);

  // ── Run B: 无新数据（checkpoint=2000）────────────────────────────────────

  console.log("Run B — 无新 segment (checkpoint=2000，验证 early-exit 开销)");
  hr();

  const rB = await incrementalCompact(bucket, req);
  console.log(`  FE 新 segment: ${rB.feNewSegments}  ME 新 segment: ${rB.meNewSegments[METRIC_EVENT] ?? 0}`);
  console.log(`  耗时: ${fmtMs(rB.durationMs)}\n`);

  // ── Run C: 模拟 1000 个新 segment（checkpoint 强制回到 1000）────────────

  console.log("Run C — 模拟 1000 个新 segment (强制 checkpoint=1000)");
  hr();

  const cpC: CompactCheckpoint = {
    feLastSeq:  1000,
    meLastSeq:  { [METRIC_EVENT]: 1000 },
    updatedAt:  new Date().toISOString(),
  };
  await writeCheckpoint(bucket, ENV_ID, FLAG_KEY, DATE, cpC);

  const rC = await incrementalCompact(bucket, req);
  console.log(`  FE 新 segment: ${rC.feNewSegments}  ME 新 segment: ${rC.meNewSegments[METRIC_EVENT] ?? 0}`);
  console.log(`  耗时: ${fmtMs(rC.durationMs)}\n`);

  // ── Run D: 真实新增 200 个 segment ───────────────────────────────────────

  console.log("Run D — 真实新增 200 个 segment (seq 2001-2200)，然后增量 compact");
  hr();

  // 1. 上传 200 个新 segment（seq 从 2001 开始）
  const seedStart = Date.now();
  await seedNewSegments(rawBucket, 2000, 200);
  console.log(`  上传耗时: ${fmtMs(Date.now() - seedStart)}\n`);

  // 2. 运行增量 compact（checkpoint 在 2000，只处理 2001-2200）
  const rD = await incrementalCompact(bucket, req);
  console.log(`  FE 新 segment: ${rD.feNewSegments}  ME 新 segment: ${rD.meNewSegments[METRIC_EVENT] ?? 0}`);
  console.log(`  checkpoint 更新至: FE seq=${rD.checkpoint.feLastSeq}`);
  console.log(`  compact 耗时: ${fmtMs(rD.durationMs)}\n`);

  // ── 对比汇总 ─────────────────────────────────────────────────────────────

  banner("对比结果");
  console.log("  场景                          耗时          segs/s");
  console.log("  ─────────────────────────────────────────────────────");
  console.log(`  全量 compact (bench-r2)       ~173s         ~23 segs/s`);
  console.log(`  Run A 增量从头 (2000 segs)    ${fmtMs(rA.durationMs).padEnd(14)}${(4000 / (rA.durationMs / 1000)).toFixed(1)} segs/s`);
  console.log(`  Run B 无新数据                ${fmtMs(rB.durationMs).padEnd(14)}—`);
  console.log(`  Run C 1000 个新 segment       ${fmtMs(rC.durationMs).padEnd(14)}${(2000 / (rC.durationMs / 1000)).toFixed(1)} segs/s`);
  console.log(`  Run D 200 个真实新 segment    ${fmtMs(rD.durationMs).padEnd(14)}${(400 / (rD.durationMs / 1000)).toFixed(1)} segs/s`);
  console.log();

  // 推算每分钟增量的成本
  const segsPerMin = Math.round(60 / 6);  // 6s/segment → 10 segs/min
  const msPerSeg   = rC.durationMs / 2000; // per segment 均摊（FE+ME=2000）
  const estPerMin  = segsPerMin * 2 * msPerSeg;
  console.log(`  实际生产估算（6s/segment → ${segsPerMin} segs/min）:`);
  console.log(`    每分钟增量 compact 约: ${fmtMs(estPerMin)}`);
  console.log(`    CF Worker 30s 限制:    ${estPerMin < 30_000 ? "✅ 安全" : "⚠️  超限"}`);
  console.log();

  process.exit(0);
}

main().catch((err) => { console.error("Fatal:", err); process.exit(1); });
