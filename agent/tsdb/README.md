# agent/tsdb

A purpose-built, embedded **columnar time-series storage engine** for FeatBit A/B testing events.

This directory contains two projects that work together:

| Project | Type | Role |
|---|---|---|
| `FeatBit.DataWarehouse` | .NET class library | Columnar on-disk storage engine; zero infrastructure dependencies |
| `FeatBit.TsdbServer` | ASP.NET Core Minimal API | HTTP wrapper; exposes DataWarehouse over three endpoints on port **5059** |

## What it does

Stores two types of events to disk and queries them to compute per-variant statistics that feed directly into Bayesian statistical analysis:

| Table | Records | Partitioned by |
|---|---|---|
| `flag-evals` | Feature flag exposure events (who saw which variant) | `(env_id, flag_key, date)` |
| `metric-events` | Custom conversion / metric events (purchases, clicks, etc.) | `(env_id, event_name, date)` |

A 3-step query engine then joins them to produce experiment results:

1. **Build exposure map** — scan flag-eval segments, apply variant / traffic-bucket / audience filters, keep first-exposure per user
2. **Balance variants** — downsample over-represented arms to equal N (Bayesian A/B mode)
3. **Aggregate metric events** — join on `user_key`, compute per-user values, then per-variant `{n, k}` (binary) or `{n, mean, variance}` (continuous)

Output feeds directly into `analyze-bayesian.py` via `ExperimentResult.ToPythonInputDict()`.

## Architecture

```
TsdbServer (HTTP port 5059)
│
│  POST /api/track              → TrackEndpoints
│  POST /api/query/experiment   → QueryEndpoints
│  GET  /health                 → TrackEndpoints
│
│  (direct in-process method calls — no HTTP, no IPC)
│
└── StorageEngine (DataWarehouse class library)
    │   top-level facade (write + query)
    │
    ├── PartitionWriter<T>     ← one writer per (table, env, key, date)
    │   └── Channel<T>         ← non-blocking writes; background flush task
    │
    ├── FlagEvalSegmentWriter  ← serializes a batch → .fbs file
    ├── MetricEventSegmentWriter
    │
    └── ExperimentQueryEngine
        ├── FlagEvalScanner    ← step 1 & 2
        └── MetricEventScanner ← step 3
```

### How TsdbServer calls DataWarehouse

`FeatBit.TsdbServer` has a project reference to `FeatBit.DataWarehouse`. There is **no HTTP call, no inter-process communication, no message queue** between them. They run in the same .NET process:

1. **Startup** (`Program.cs`) creates one `StorageEngine` instance and one `ExperimentQueryEngine` instance, registers both as singletons in the DI container.
2. **Track handler** resolves `StorageEngine` via constructor injection and calls `WriteFlagEvalAsync` / `WriteMetricEventAsync` directly — these return almost instantly because writes are enqueued into an in-memory `Channel<T>` and a background task flushes to disk.
3. **Query handler** resolves `ExperimentQueryEngine` and calls `QueryAsync` — this reads `.fbs` segment files from disk, applies filters, and returns aggregated stats.
4. **Shutdown** — `Program.cs` calls `storageEngine.DisposeAsync()` to flush all in-flight batches before the process exits.

```
HTTP request
     │
     ▼
TrackEndpoints.HandleTrackAsync(StorageEngine storage)
     │  calls
     ▼
storage.WriteFlagEvalAsync(record)   ← Channel.Writer.TryWrite(record)
     │  returns immediately
     │
     └── background flush task ──→ FlagEvalSegmentWriter.WriteAsync(batch, path)
                                          │
                                          ▼
                                    /data/tsdb/flag-evals/.../seg-XXXXXXXX.fbs
```

### On-disk layout

```
{dataRoot}/
  flag-evals/
    {env_id}/{flag_key}/{yyyy-MM-dd}/
      seg-00000001.fbs
      seg-00000002.fbs
  metric-events/
    {env_id}/{event_name}/{yyyy-MM-dd}/
      seg-00000001.fbs
```

### Segment file format (`.fbs`)

Each file is a self-contained, column-oriented segment:

```
[4B magic "FBDW"] [1B version] [4B header-len] [JSON header] [column data blocks...]
```

Column encodings:

| Column type | Encoding | Compression |
|---|---|---|
| `Timestamp` | Delta (first absolute, rest forward-deltas as int64) | Brotli |
| `String` | Dictionary (dict + int32 indices) | Brotli |
| `NullableString` | Null bitmap + dictionary | Brotli |
| `NullableDouble` | Null bitmap + raw doubles (non-null only) | Brotli |
| `Byte` | Raw bytes | Brotli |

Query-time skipping optimizations built into each segment header:

- **Zone maps** — `(ZoneMin, ZoneMax)` timestamp range per column → O(1) time-range pruning
- **Bloom filters** — on `user_key`, `variant`, `experiment_id` columns → O(1) skip when value is definitely absent

## HTTP Endpoints (TsdbServer)

All endpoints are served on port **5059**. Authentication uses the raw Authorization header value as the environment ID (`EnvId`).

---

### `GET /health`

Health check — no authentication required.

**Response `200 OK`:**
```json
{ "status": "healthy" }
```

---

### `GET /api/stats`

Returns the current on-disk storage size — no authentication required. Counts only flushed `.fbs` segment files; in-flight records buffered in memory are not included.

**Response `200 OK`:**
```json
{
  "dataRoot": "/data/tsdb",
  "total":        { "files": 142, "sizeBytes": 18350080, "sizeHuman": "17.5 MB" },
  "flagEvals":    { "files":  98, "sizeBytes": 12582912, "sizeHuman": "12.0 MB" },
  "metricEvents": { "files":  44, "sizeBytes":  5767168, "sizeHuman": "5.5 MB"  }
}
```

---

### `POST /api/track`

Ingest a batch of SDK insight events. This is the write path: flag evaluations and metric events are enqueued into in-memory channels and flushed to disk within `FlushIntervalSeconds` (default 1 s).

**Authorization:** `Authorization: <env-id>`

**Request body:** array of `TrackPayload` objects (same wire format as `agent/data`):
```json
[
  {
    "user": {
      "keyId": "user-123",
      "name": "Alice",
      "properties": { "plan": "premium", "region": "US" }
    },
    "variations": [
      {
        "flagKey": "checkout-v2",
        "variant": "treatment",
        "sendToExperiment": true,
        "experimentId": "exp-001",
        "layerId": null,
        "timestamp": 1712880000
      }
    ],
    "metrics": [
      {
        "eventName": "purchase",
        "numericValue": 49.99,
        "appType": "web",
        "timestamp": 1712880120
      }
    ]
  }
]
```

`timestamp` values are **unix seconds** (the server multiplies by 1000 internally).

**Response `200 OK`:** empty body on success.  
**Response `401 Unauthorized`:** missing/empty Authorization header.  
**Response `400 Bad Request`:** malformed JSON.

---

### `POST /api/query/experiment`

Query aggregated experiment statistics for a single metric. Runs the 3-step scan (exposure map → balance → aggregate) over on-disk segment files and returns per-variant stats ready to feed into the Bayesian analyzer.

**Authorization:** `Authorization: <env-id>`

**Request body:**
```json
{
  "envId": "env-abc",
  "flagKey": "checkout-v2",
  "metricEvent": "purchase",
  "metricType": "binary",
  "metricAgg": "once",
  "controlVariant": "control",
  "treatmentVariant": "treatment",
  "start": "2026-04-01T00:00:00Z",
  "end": "2026-04-12T23:59:59Z",
  "experimentId": "exp-001",
  "layerId": null,
  "trafficPercent": 100,
  "trafficOffset": 0,
  "audienceFilters": "[{\"property\":\"plan\",\"op\":\"eq\",\"value\":\"premium\"}]",
  "method": "bayesian_ab"
}
```

| Field | Required | Description |
|---|---|---|
| `envId` | ✓ | Environment identifier (must match token in Authorization header) |
| `flagKey` | ✓ | Feature flag key |
| `metricEvent` | ✓ | Metric event name to measure |
| `metricType` | ✓ | `binary` \| `revenue` \| `count` \| `duration` |
| `metricAgg` | — | `once` (default) \| `sum` \| `mean` \| `count` \| `latest` |
| `controlVariant` | ✓ | Variant name used as control arm |
| `treatmentVariant` | ✓ | Variant name used as treatment arm |
| `start` / `end` | ✓ | ISO 8601 date range for the query window |
| `experimentId` | — | Filter exposures to a specific experiment |
| `layerId` | — | Filter by layer (for multi-layer experiments) |
| `trafficPercent` | — | Hash-bucket range width (default 100) |
| `trafficOffset` | — | Hash-bucket range start (default 0) |
| `audienceFilters` | — | JSON-encoded `AudienceFilterEntry[]` |
| `method` | — | `bayesian_ab` (default) or `bandit` |

**Response `200 OK`:**
```json
{
  "metricType": "binary",
  "variants": {
    "control":   { "n": 4821, "k": 1543 },
    "treatment": { "n": 4821, "k": 2169 }
  }
}
```

For continuous metrics, `k` is omitted and `mean`, `variance`, `total` are populated instead.

**Response `401` / `400` / `500`:** as above.

---

## Checking storage size in Docker

All data is written to `/data/tsdb` inside the container (a named Docker volume). To inspect it without stopping the container:

```bash
# Total size of all stored data
docker exec <container-name> du -sh /data/tsdb

# Size breakdown by table
docker exec <container-name> du -sh /data/tsdb/flag-evals /data/tsdb/metric-events

# Number of segment files
docker exec <container-name> find /data/tsdb -name "*.fbs" | wc -l

# Segment files sorted by size (largest first)
docker exec <container-name> \
  find /data/tsdb -name "*.fbs" -exec du -sh {} + | sort -rh | head -20

# Directory tree with sizes (requires tree; curl is installed in the image)
docker exec <container-name> du -ah /data/tsdb | sort -rh | head -40
```

To inspect from the **host** when using a named volume:

```bash
# Find the volume mount point on the host
docker volume inspect <volume-name>

# Then navigate to "Mountpoint" shown in the output
ls -lh /var/lib/docker/volumes/<volume-name>/_data/
```

In `docker-compose.yml` you can mount the volume to a host path for easy browsing:

```yaml
services:
  tsdb:
    volumes:
      - ./tsdb-data:/data/tsdb   # host path bind mount
```



## Usage (DataWarehouse library)

```csharp
    dataRoot: "/data/fbdw",
    maxBatchSize: 10_000,
    flushInterval: TimeSpan.FromMilliseconds(500));

// Write a flag evaluation (non-blocking)
await engine.WriteFlagEvalAsync(new FlagEvalRecord
{
    EnvId      = "env-abc",
    FlagKey    = "checkout-v2",
    UserKey    = "user-123",
    Variant    = "treatment",
    Timestamp  = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds(),
    HashBucket = FlagEvalRecord.ComputeHashBucket("user-123", "checkout-v2"),
});

// Write a metric event
await engine.WriteMetricEventAsync(new MetricEventRecord
{
    EnvId      = "env-abc",
    EventName  = "purchase",
    UserKey    = "user-123",
    Timestamp  = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds(),
    NumericValue = 49.99,
});

// Query experiment results
var qe = engine.CreateQueryEngine();
var result = await qe.QueryAsync(new ExperimentQuery
{
    EnvId             = "env-abc",
    FlagKey           = "checkout-v2",
    MetricEvent       = "purchase",
    MetricType        = "binary",
    ControlVariant    = "control",
    TreatmentVariants = ["treatment"],
    Start             = DateTimeOffset.UtcNow.AddDays(-7),
    End               = DateTimeOffset.UtcNow,
});

// Feed to Bayesian analyzer
var pythonInput = result.ToPythonInputDict("purchase");
```

### Audience & traffic filtering

```csharp
var query = new ExperimentQuery
{
    // ... required fields ...

    // Traffic splitting (hash_bucket ∈ [10, 60))
    TrafficPercent = 50,
    TrafficOffset  = 10,

    // User property filters
    AudienceFilters =
    [
        new AudienceFilter { Property = "plan",   Op = "eq",  Value  = "premium" },
        new AudienceFilter { Property = "region", Op = "in",  Values = ["US", "CA"] },
    ],

    // Analysis method
    Method = "bayesian_ab",  // or "bandit"
};
```

### Multiple metrics (primary + guardrails)

```csharp
var results = await qe.QueryManyAsync(
    primaryQuery,
    guardrailEventNames: ["error_rate", "session_duration"]);

// results["purchase"]       → primary metric
// results["error_rate"]     → guardrail
// results["session_duration"] → guardrail
```

## Project structure

```
src/FeatBit.DataWarehouse/
  StorageEngine.cs          ← public API entry point
  Models/
    FlagEvalRecord.cs
    MetricEventRecord.cs
  Storage/
    PartitionWriter.cs      ← buffered write + background flush
    FlagEvalSegmentWriter.cs
    MetricEventSegmentWriter.cs
    SegmentReader.cs
    ColumnEncoder.cs        ← encode/decode each column type
    BloomFilter.cs
    PathHelper.cs
    SegmentFormat.cs        ← file format constants + header models
  Query/
    ExperimentQueryEngine.cs
    ExperimentQuery.cs
    ExperimentResult.cs
    FlagEvalScanner.cs
    MetricEventScanner.cs
    AudienceFilter.cs

src/FeatBit.TsdbServer/   ← ASP.NET Core Minimal API (HTTP host)
  Program.cs              ← DI wiring, StorageEngine singleton, route registration
  Endpoints/
    TrackEndpoints.cs     ← POST /api/track, GET /health
    QueryEndpoints.cs     ← POST /api/query/experiment
  Models/
    Dtos.cs               ← TrackPayload, ExperimentQueryRequest/Response DTOs
  Services/
    EnvAuth.cs            ← extracts EnvId from Authorization header
  appsettings.json        ← DataRoot, Storage.MaxBatchSize, FlushIntervalSeconds

tests/FeatBit.DataWarehouse.Tests/
  Program.cs              ← manual test runner (no xUnit dependency)
```

## Configuration (TsdbServer)

| Key | Default | Description |
|---|---|---|
| `DataRoot` | `/data/tsdb` | Root directory for all segment files |
| `Storage:MaxBatchSize` | `10000` | Flush a segment when this many records accumulate |
| `Storage:FlushIntervalSeconds` | `1` | Max seconds between flushes even when batch is not full |
| `ASPNETCORE_URLS` | `http://+:5059` | Listen address |

Override via environment variables (prefix `Storage__` for nested keys):

```bash
docker run -e DataRoot=/mnt/data -e Storage__FlushIntervalSeconds=2 ...
```

## Design notes

**DataWarehouse is a class library, not a standalone service.** TsdbServer embeds it in-process — there is no HTTP call, no IPC, no message queue between the HTTP layer and the storage engine. The library can also be embedded directly into `agent/data` as a drop-in replacement for the PostgreSQL-backed `MetricCollector`.

**Write path** is lock-free: incoming records are pushed into a bounded `Channel<T>` per partition; a single background task drains the channel, batches records, and flushes a segment file. Under normal load, `WriteAsync` returns synchronously.

**Read path** is read-only and parallelizable across segments. Segments are immutable once written.

**Only one external dependency** — `System.IO.Hashing` (XxHash3 for hash-bucket computation and bloom filter hashing).

## Requirements

- .NET 10
- No external services (no PostgreSQL, Redis, Kafka required)

## Running the tests

```bash
cd tests/FeatBit.DataWarehouse.Tests
dotnet run
```

The test runner outputs `[PASS]` / `[FAIL]` for each assertion and exits with a summary.
