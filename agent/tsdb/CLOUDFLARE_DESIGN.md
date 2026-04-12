# TSDB Cloudflare Edition — Architecture Design

> Replaces the .NET `FeatBit.DataWarehouse` + `FeatBit.TsdbServer` with Cloudflare Workers + R2 + Durable Objects, preserving identical API contracts and query semantics.

---

## 1. Component Mapping (.NET → Cloudflare)

| .NET Component | Role | Cloudflare Replacement | Why |
|---|---|---|---|
| `TsdbServer` (ASP.NET) | HTTP API (track + query + stats) | **Worker** | Serverless HTTP handler, same 3 endpoints |
| `PartitionWriter<T>` + `Channel<T>` | Per-partition memory buffer + background flush | **Durable Objects** (one per partition key) | Single-threaded actor per partition — same semantics as Channel + timer, natural concurrency isolation |
| Disk (`.fbs` segment files) | Columnar storage | **R2** (same path layout) | Object storage with S3-compatible API, prefix listing, range reads |
| `ColumnEncoder` (Brotli + delta/dict) | Column compression | **TypeScript reimplementation** | Same encodings (delta, dictionary, null-bitmap), raw `Uint8Array` + `CompressionStream('deflate-raw')` or bundled Brotli WASM |
| `SegmentReader` | Read + decode segments | **TypeScript reimplementation** | Reads from R2 via `get()` with range headers |
| `ExperimentQueryEngine` | Parallel segment scanning | **Worker** with `Promise.all()` | Workers can fire hundreds of concurrent R2 `get()` calls — analogous to `Parallel.ForEachAsync` |
| `BloomFilter` / zone maps | O(1) segment pruning | **Same approach, R2 metadata** | Store zone-min/zone-max and bloom filters in R2 object custom metadata for header-free pruning |
| `StorageEngine` eviction | Reclaim memory for stale writers | **Durable Object alarm + auto-eviction** | DOs auto-sleep after inactivity; alarm API for explicit cleanup |

---

## 2. Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│                     Cloudflare Edge                          │
│                                                              │
│  ┌──────────────────────────────────────────────────────┐    │
│  │                  Worker (tsdb)                        │    │
│  │                                                       │    │
│  │  POST /api/track ──→ route to Durable Object(s)      │    │
│  │  POST /api/query/experiment ──→ parallel R2 scan      │    │
│  │  GET  /api/stats ──→ R2 prefix listing                │    │
│  │  GET  /health                                         │    │
│  └──────┬───────────────────────────────┬────────────────┘    │
│         │                               │                     │
│         ▼                               ▼                     │
│  ┌──────────────┐              ┌──────────────┐              │
│  │ Durable      │              │     R2       │              │
│  │ Objects      │   flush ──→  │  (segments)  │              │
│  │              │              │              │              │
│  │ One per      │              │ flag-evals/  │              │
│  │ (table,env,  │              │   {env}/{key}│              │
│  │  key,date)   │              │    /{date}/  │              │
│  │              │              │     seg-*.fbs│              │
│  │ Buffer 0-10k │              │              │              │
│  │ events       │              │ metric-events│              │
│  │ Timer flush  │              │   /…/…/…     │              │
│  └──────────────┘              └──────────────┘              │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

---

## 3. Write Path — Durable Objects as Partition Buffers

### 3.1 Why Durable Objects, Not Queues

| Criterion | Durable Objects | Queues |
|---|---|---|
| Batching with max-size + timer flush | ✅ `alarm()` API + in-memory array | ⚠️ Consumer batching exists but less control |
| Per-partition isolation | ✅ One DO per `(table,env,key,date)` — each is single-threaded | ❌ Single consumer, manual partitioning |
| Back-pressure | ✅ DO can reject or buffer when full | ❌ Queue depth is opaque |
| Segment counter continuity | ✅ DO storage persists counter across restarts | ❌ Need external state |
| **Matches .NET PartitionWriter semantics** | **✅ 1:1 mapping** | ❌ Different mental model |

### 3.2 Durable Object Design: `PartitionWriterDO`

```typescript
export class PartitionWriterDO extends DurableObject {
  private buffer: (FlagEvalRecord | MetricEventRecord)[] = [];
  private segmentCounter: number = 0;
  private partitionKey: string = "";  // e.g. "flag-evals/env-001/homepage-banner/2026-04-12"

  // ── Config ──
  static readonly MAX_BATCH_SIZE = 10_000;
  static readonly FLUSH_INTERVAL_MS = 1_000;   // 1 second (same as .NET TsdbServer)

  // Called by Worker on POST /api/track
  async write(records: Record[]): Promise<void> {
    this.buffer.push(...records);

    // Batch full → immediate flush (same as .NET: batch.Count >= MaxBatchSize)
    if (this.buffer.length >= PartitionWriterDO.MAX_BATCH_SIZE) {
      await this.flush();
    } else if (this.buffer.length === records.length) {
      // First write after empty buffer → arm the timer
      await this.ctx.storage.setAlarm(
        Date.now() + PartitionWriterDO.FLUSH_INTERVAL_MS
      );
    }
  }

  // alarm() fires when flush timer expires — same as PeriodicTimer in .NET
  async alarm(): Promise<void> {
    if (this.buffer.length > 0) {
      await this.flush();
    }
  }

  private async flush(): Promise<void> {
    const batch = this.buffer.splice(0);  // drain entire buffer
    this.segmentCounter++;

    const segName = `seg-${String(this.segmentCounter).padStart(8, '0')}.fbs`;
    const key = `${this.partitionKey}/${segName}`;
    const encoded = encodeSegment(batch);    // columnar encoding (see §5)

    await this.env.TSDB_BUCKET.put(key, encoded, {
      customMetadata: {
        rowCount:  String(batch.length),
        zoneMin:   String(Math.min(...batch.map(r => r.timestamp))),
        zoneMax:   String(Math.max(...batch.map(r => r.timestamp))),
        // Bloom filters encoded as base64 — enables header-free pruning
        bloomUserKey: buildBloomBase64(batch.map(r => r.userKey)),
      },
    });
  }
}
```

**Key insight**: Each `(table, envId, key, date)` maps deterministically to one DO instance via `env.PARTITION_WRITER.idFromName(partitionKey)`. Traffic to different `envId+flagKey` combos hits different DOs — **fully concurrent with zero contention**, exactly like .NET's `ConcurrentDictionary<string, PartitionWriter<T>>`.

### 3.3 Worker → DO Routing

```typescript
// worker.ts — POST /api/track handler
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const envId = getEnvId(request.headers);      // Authorization header
    const payloads: TrackPayload[] = await request.json();

    // Group events by partition key (same as .NET StorageEngine routing)
    const groups = groupByPartition(envId, payloads);

    // Fan-out to Durable Objects concurrently — same as .NET's
    // "per-partition writer from ConcurrentDictionary" pattern
    await Promise.all(
      groups.map(([partitionKey, records]) => {
        const id = env.PARTITION_WRITER.idFromName(partitionKey);
        const stub = env.PARTITION_WRITER.get(id);
        return stub.write(records);
      })
    );

    return new Response(null, { status: 200 });
  },
};
```

This mirrors the .NET pattern exactly:
- .NET: `GetOrCreateFlagEvalWriter(envId, flagKey, timestamp)` → `PartitionWriter<T>.WriteAsync()`
- CF: `env.PARTITION_WRITER.idFromName(key)` → `stub.write(records)`

---

## 4. Storage Layout in R2

**Identical** to local disk, just object keys instead of file paths:

```
tsdb/
  flag-evals/
    {env_id}/{flag_key}/{yyyy-MM-dd}/
      seg-00000001.fbs
      seg-00000002.fbs
      …
  metric-events/
    {env_id}/{event_name}/{yyyy-MM-dd}/
      seg-00000001.fbs
      …
```

### 4.1 R2 Custom Metadata per Segment Object

Stored alongside each `.fbs` object so the **query engine can prune without downloading the segment body**:

| Metadata Key | Value | Purpose |
|---|---|---|
| `rowCount` | `"8500"` | Know row count without parsing header |
| `zoneMin` | `"1712880000000"` | Zone map: earliest timestamp (unix ms) |
| `zoneMax` | `"1712966399000"` | Zone map: latest timestamp (unix ms) |
| `bloomUserKey` | `"base64…"` | Bloom filter for user_key column |
| `bloomVariant` | `"base64…"` | Bloom filter for variant column |
| `bloomExperimentId` | `"base64…"` | Bloom filter for experiment_id column |

This is **strictly better** than the .NET version where you must read 9 + headerLen bytes of the file to get zone maps. With R2 metadata, a `list()` call returns all metadata — **zero GET operations** for pruning.

---

## 5. Segment Format (TypeScript Implementation)

Reuse the same `.fbs` binary format for compatibility. TypeScript implementation using `ArrayBuffer` / `DataView`:

```
[4B magic "FBDW"] [1B version] [4B header-len] [JSON header] [column data blocks…]
```

### 5.1 Column Encoding (TypeScript)

| Encoding | .NET Implementation | TypeScript Equivalent |
|---|---|---|
| **Delta timestamps** | `BinaryPrimitives.WriteInt64LittleEndian` + Brotli | `BigInt64Array` + `CompressionStream('deflate-raw')` or Brotli WASM |
| **Dictionary strings** | `BinaryWriter` + Brotli | `TextEncoder` + manual dict → `Uint8Array` + compression |
| **Null bitmap** | `byte[]` bit manipulation | `Uint8Array` with same `(i >> 3)` / `(1 << (i & 7))` logic |
| **Nullable doubles** | Null bitmap + raw `double[]` + Brotli | Null bitmap + `Float64Array` + compression |
| **Raw bytes** | `byte[]` + Brotli | `Uint8Array` + compression |
| **Bloom filter** | `XxHash3` → bit array | `@aspect/xxhash3` (WASM) or FNV1a fallback → same bit array |

### 5.2 Compression Choice

| Option | Pros | Cons |
|---|---|---|
| **DecompressionStream('deflate-raw')** | Native in Workers, zero bundle size | ~15% worse ratio than Brotli on this data |
| **Brotli WASM** | Identical to .NET version, best ratio | ~200 KB WASM bundle, slower init |
| **No compression, rely on R2** | Simplest code | Larger storage, slower transfers |

**Recommendation**: Use `deflate-raw` via native `CompressionStream` / `DecompressionStream`. The 15% ratio penalty is negligible for segments ≤10 KB compressed, and it avoids WASM overhead. If local ↔ cloud segment interchange is needed, add a `compression` field to the header JSON (`"brotli"` or `"deflate"`).

---

## 6. Query Path — Parallel R2 Scanning

### 6.1 Execution Flow

The query engine runs entirely inside a single Worker invocation (no Durable Objects needed for reads):

```
POST /api/query/experiment
  │
  ├── 1. R2 list() by prefix → enumerate segment keys per date
  │      "flag-evals/{envId}/{flagKey}/2026-02-12/"
  │      "flag-evals/{envId}/{flagKey}/2026-02-13/"
  │      … (up to 60 dates for a 60-day query)
  │
  ├── 2. Prune via R2 customMetadata (zone maps + bloom filters)
  │      → skip segments outside time range
  │      → skip segments where bloom says variant is absent
  │
  ├── 3. Promise.all(): download + decode remaining segments concurrently
  │      → R2 get() for each non-pruned segment
  │      → decode columns, apply row-level filters
  │      → build partial exposure maps
  │
  ├── 4. Merge → Balance → Aggregate (same algorithm as .NET)
  │
  └── 5. Return ExperimentResult JSON
```

### 6.2 Parallelism: .NET vs Cloudflare

| Dimension | .NET (local disk) | Cloudflare Workers |
|---|---|---|
| Parallelism mechanism | `Parallel.ForEachAsync` with `ProcessorCount` | `Promise.all()` on concurrent `R2.get()` |
| I/O model | OS-level parallel file reads (SSD IOPS) | Many concurrent HTTP-level fetches to R2 (within same colo) |
| Typical concurrency | 4–16 (CPU cores) | **50–200** concurrent R2 fetches (I/O-bound, not CPU-bound) |
| Latency per segment read | ~0.1 ms (SSD random read) | ~2–5 ms (R2 in-colo fetch) |
| 60-day query, 200 segments | ~15 ms (16 parallel × 0.1 ms × ~10 batches) | ~15–30 ms (200 concurrent × 5 ms, 1–2 batches) |
| Column decode CPU | Full .NET speed (~nanoseconds per row) | ~3–5× slower in V8 isolate, but offset by higher I/O parallelism |

**Net result**: Comparable performance for 60-day queries. The higher per-object latency of R2 is compensated by much higher fanout (200 concurrent reads vs 16).

### 6.3 Optimization: Header-Free Pruning via R2 Metadata

In the .NET version, pruning requires:
1. Open every `.fbs` file
2. Read 9-byte preamble + N-byte JSON header
3. Parse zone maps and bloom filters from header
4. Decide whether to read column data

With R2 custom metadata:
1. `list({ prefix })` returns **all segment keys and their custom metadata** in one call
2. Zone map + bloom filter pruning happens on the list results — **zero GET operations for pruned segments**
3. Only non-pruned segments trigger `R2.get()`

This is significantly more efficient than the .NET header-read-per-file approach.

### 6.4 Large Query Optimization: Daily Roll-ups

For queries spanning 30–90 days, we can add an **optional daily roll-up** layer:

```
tsdb/
  rollups/
    {env_id}/{flag_key}/{yyyy-MM-dd}.rollup.json
```

Each roll-up contains pre-computed per-user first-exposure and per-user metric accumulator for that day. The query engine checks for roll-ups first and only falls back to raw segments for days without roll-ups (today, or days with late-arriving data).

This is an optional enhancement — not needed for MVP.

---

## 7. Concurrency & Write Performance Analysis

### 7.1 The .NET Advantages and How They Map

| .NET Advantage | How It's Achieved | Cloudflare Equivalent |
|---|---|---|
| **Fast HTTP response** (Channel write returns instantly) | `Channel.Writer.TryWrite` is synchronous, O(1) | DO stub `write()` call is an in-colo RPC (~1 ms). Slightly slower than Channel write, but still sub-ms for the HTTP response if we don't `await` the DO. |
| **Per-partition concurrency** (ConcurrentDictionary of writers) | Each writer is independent; different flags write to different channels | Each `(table,env,key,date)` → unique DO. Different partition keys → different DOs → **zero contention**. |
| **Background flush** (timer + batch-size trigger) | `PeriodicTimer` + `Channel.Reader` drain loop | DO `alarm()` API for timer + immediate flush when buffer reaches MAX_BATCH_SIZE. |
| **10,000 events per segment** (fast sequential writes) | Single flush task per writer; `Channel` ensures ordered drain | DO is single-threaded actor; events arrive in order; flush is async `R2.put()`. |

### 7.2 Write Hot Path Performance

```
SDK → POST /api/track → Worker → groupByPartition → fan-out to DOs

Per-DO write:
  1. Receive records (in-memory push)         ~0 ms
  2. Check buffer size                        ~0 ms
  3. If full → flush:
     a. Encode segment (columns + compress)   ~5–20 ms (CPU bound)
     b. R2.put() (in-colo)                    ~5–10 ms
  4. Else → arm alarm if first write          ~0 ms

Total: Worker response returns in < 5 ms (1 ms DO routing × N partitions in parallel)
       Flush happens async inside the DO (transparent to caller)
```

### 7.3 Back-pressure

- DO buffer has a soft limit (e.g., 50,000 records). If breached, the `write()` call returns an error → Worker returns 429 to the SDK.
- This mirrors .NET's `BoundedChannelOptions { FullMode = Wait }`.

---

## 8. API Contract (Unchanged)

All three endpoints are identical to the .NET TsdbServer — SDKs don't know they're talking to Cloudflare:

| Endpoint | Method | Behavior |
|---|---|---|
| `/health` | GET | `{ "status": "healthy" }` |
| `/api/track` | POST | Accepts `TrackPayload[]`, returns 200. Auth via Authorization header = envId. |
| `/api/query/experiment` | POST | Accepts `ExperimentQueryRequest`, returns `ExperimentQueryResponse`. |
| `/api/stats` | GET | Returns file/size counts from R2 prefix listing. |

---

## 9. Project Structure

```
agent/tsdb-cloudflare/
├── wrangler.toml                    ← Worker config (R2 binding, DO binding)
├── package.json
├── tsconfig.json
├── src/
│   ├── index.ts                     ← Worker entry: routing (fetch handler)
│   ├── endpoints/
│   │   ├── track.ts                 ← POST /api/track → fan-out to DOs
│   │   ├── query.ts                 ← POST /api/query/experiment → R2 scan
│   │   └── stats.ts                 ← GET /api/stats → R2 list
│   ├── durable-objects/
│   │   └── partition-writer.ts      ← PartitionWriterDO class
│   ├── storage/
│   │   ├── segment-format.ts        ← Magic, version, header types
│   │   ├── column-encoder.ts        ← Encode/decode: timestamps, strings, doubles, bytes
│   │   ├── segment-writer.ts        ← Encode batch → ArrayBuffer (.fbs)
│   │   ├── segment-reader.ts        ← Decode .fbs from R2 get()
│   │   ├── bloom-filter.ts          ← Bloom filter (FNV1a or xxHash3 WASM)
│   │   └── path-helper.ts           ← Partition key construction
│   ├── query/
│   │   ├── experiment-engine.ts     ← Orchestrate: exposure → balance → aggregate
│   │   ├── flag-eval-scanner.ts     ← Step 1: build exposure map from R2 segments
│   │   └── metric-event-scanner.ts  ← Step 3: aggregate metrics joined to exposure
│   ├── models/
│   │   ├── flag-eval-record.ts
│   │   ├── metric-event-record.ts
│   │   └── dtos.ts                  ← TrackPayload, ExperimentQueryRequest/Response
│   ├── services/
│   │   └── env-auth.ts              ← Authorization header → envId
│   └── lib/
│       ├── compression.ts           ← deflate-raw compress/decompress helpers
│       └── hash.ts                  ← Hash bucket computation (XxHash3 or FNV1a)
└── tests/
    ├── column-encoder.test.ts
    ├── segment-roundtrip.test.ts
    ├── partition-writer.test.ts
    └── query-engine.test.ts
```

### wrangler.toml

```toml
name = "featbit-tsdb"
main = "src/index.ts"
compatibility_date = "2026-04-01"

[[r2_buckets]]
binding = "TSDB_BUCKET"
bucket_name = "featbit-tsdb"

[[durable_objects.bindings]]
name = "PARTITION_WRITER"
class_name = "PartitionWriterDO"

[[migrations]]
tag = "v1"
new_classes = ["PartitionWriterDO"]
```

---

## 10. Cost & Limits Analysis

### 10.1 R2 Pricing (key factors)

| Operation | Price | TSDB Usage Pattern |
|---|---|---|
| Class A (PUT, LIST) | $4.50 / million | Each flush = 1 PUT. 10k events/seg → low PUT count |
| Class B (GET) | $0.36 / million | Each query reads ~N segments. Pruning minimizes N |
| Storage | $0.015 / GB-month | Columnar + compressed → very compact |
| Egress | **Free** | R2 has zero egress fees |

### 10.2 Scenario: 1M events/day

```
Writes:  1M events ÷ 10k/segment = 100 PUTs/day = 3,000 PUTs/month
         → $0.01/month (negligible)

Queries: 10 queries/day × 200 segments/query = 2,000 GETs/day = 60,000/month
         → $0.02/month (negligible)

Storage: 1M events × ~50 bytes/event compressed ≈ 50 MB/day ≈ 1.5 GB/month
         → $0.02/month

Total:   ~$0.05/month for 1M events/day
```

### 10.3 Worker Limits

| Limit | Free | Paid ($5/mo) | Impact |
|---|---|---|---|
| CPU time per request | 10 ms | 30 s | Query decoding is the bottleneck. 60-day query with 200 segments × 10k rows: ~500 ms CPU. Paid plan required. |
| Subrequests per request | 50 | 1000 | 200 R2 gets per query is fine on paid plan. |
| Durable Object storage | 1 GB included | $0.20/GB | Only stores segment counter + buffer config. Minimal. |

---

## 11. What's NOT Needed from Cloudflare

| Service | Why Not |
|---|---|
| **KV** | Too slow for write path (eventual consistency). R2 is strongly consistent for reads-after-writes. |
| **D1** (SQLite) | No SQL needed; columnar segments are the right abstraction. |
| **Workers AI** | No ML in the storage layer (Bayesian analysis stays in Python). |
| **Hyperdrive** | No PostgreSQL connection. |
| **Vectorize** | No vector search. |

---

## 12. Migration Path

### Phase 1: Dual-write (parallel operation)
- Both .NET TsdbServer and Cloudflare Worker accept `/api/track`
- `ExperimentWorker` in `agent/data` sends to both
- Compare query results for correctness validation

### Phase 2: Read migration
- Switch `ExperimentWorker` to query Cloudflare Worker
- .NET TsdbServer becomes write-only backup

### Phase 3: Full cutover
- All traffic → Cloudflare Worker
- .NET TsdbServer decommissioned

### Segment format compatibility
- Since both versions use the same `.fbs` binary format, segments written by .NET can be uploaded to R2 and read by the CF query engine (and vice versa). This enables gradual migration without data conversion.

---

## 13. Summary: Feature Parity Checklist

| .NET Feature | Cloudflare Equivalent | Parity |
|---|---|---|
| Channel<T> memory buffer | Durable Object in-memory array | ✅ Equivalent |
| PartitionWriter per (table,env,key,date) | One DO per partition key | ✅ Equivalent |
| Timer-based flush (500ms / 1s) | DO alarm() API | ✅ Equivalent |
| Batch-size flush (10k) | Immediate flush when buffer ≥ 10k | ✅ Equivalent |
| Columnar .fbs format | Same format, TypeScript codec | ✅ Compatible |
| Zone maps (time-range pruning) | R2 custom metadata | ✅ Better (no file read needed) |
| Bloom filters | R2 custom metadata | ✅ Better (no file read needed) |
| Parallel segment scanning | `Promise.all()` concurrent R2 gets | ✅ Higher fanout |
| Balanced sampling (Bayesian AB) | Same algorithm in TypeScript | ✅ Equivalent |
| Exposure map → metric join | Same 3-step pipeline | ✅ Equivalent |
| Back-pressure (bounded channel) | DO buffer limit → 429 | ✅ Equivalent |
| Stale writer eviction | DO auto-sleep + alarm cleanup | ✅ Simpler |
| Per-partition concurrency ("几乎无障碍") | Each DO is a separate actor | ✅ Equivalent — zero contention |
| Segment counter persistence | DO durable storage | ✅ Survives restarts |
| `/api/track` contract | Same JSON schema | ✅ Identical |
| `/api/query/experiment` contract | Same JSON schema | ✅ Identical |

**Net assessment**: Full feature parity. The Cloudflare version is slightly more expensive per-operation (R2 vs SSD) but gains global edge deployment, zero infrastructure management, and better pruning efficiency via R2 metadata.
