# FeatBit.DataWarehouse

A purpose-built, embedded **columnar time-series storage engine** for FeatBit A/B testing events — written as a .NET class library with zero infrastructure dependencies.

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
StorageEngine              ← top-level facade (write + query)
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

## Usage

```csharp
// Initialize engine (creates directory if needed)
await using var engine = new StorageEngine(
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

tests/FeatBit.DataWarehouse.Tests/
  Program.cs                ← manual test runner (no xUnit dependency)
```

## Design notes

**This is a class library, not a service.** There is no HTTP API or ASP.NET Core host — by design. It is intended to be embedded directly into FeatBit's `DataServer` as a drop-in replacement for the existing PostgreSQL-backed `MetricCollector`. If you need to expose it over HTTP, wrap it in an ASP.NET Core Minimal API or background service in the host project.

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
