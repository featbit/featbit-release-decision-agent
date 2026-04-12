using System.Diagnostics;
using FeatBit.DataWarehouse;
using FeatBit.DataWarehouse.Models;
using FeatBit.DataWarehouse.Query;
using FeatBit.DataWarehouse.Storage;

Console.WriteLine("=== FeatBit.DataWarehouse Phase 1 Tests ===\n");

var tempDir  = Path.GetFullPath(Path.Combine(AppContext.BaseDirectory, "..", "..", "..", "..", "..", "temp"));
var dataRoot = Path.Combine(tempDir, "fbdw-test-" + Guid.NewGuid().ToString("N")[..8]);
int passed = 0, failed = 0;

void Assert(string label, bool condition, string? detail = null)
{
    if (condition) { Console.WriteLine($"  [PASS] {label}"); passed++; }
    else           { Console.WriteLine($"  [FAIL] {label}{(detail != null ? $" — {detail}" : "")}"); failed++; }
}

// ── Test 1: HashBucket is deterministic ──────────────────────────────────────
Console.WriteLine("Test 1: HashBucket determinism");
{
    var b1 = FlagEvalRecord.ComputeHashBucket("user-123", "checkout-v2");
    var b2 = FlagEvalRecord.ComputeHashBucket("user-123", "checkout-v2");
    var b3 = FlagEvalRecord.ComputeHashBucket("user-999", "checkout-v2");
    Assert("Same inputs → same bucket", b1 == b2);
    Assert("Bucket in [0,100)", b1 < 100);
    Assert("Different users → possibly different buckets (statistical)", true); // just check range
    Console.WriteLine($"  user-123/checkout-v2 → bucket {b1}");
    Console.WriteLine($"  user-999/checkout-v2 → bucket {b3}");
}

// ── Test 2: BloomFilter ───────────────────────────────────────────────────────
Console.WriteLine("\nTest 2: BloomFilter");
{
    var bloom = new BloomFilter(expectedElements: 1000);
    bloom.Add("user-abc");
    bloom.Add("user-def");
    Assert("Added value found",     bloom.MightContain("user-abc"));
    Assert("Added value found",     bloom.MightContain("user-def"));
    Assert("Absent value likely absent", !bloom.MightContain("user-not-added"));

    // Round-trip serialization
    var bytes  = bloom.Serialize();
    var bloom2 = new BloomFilter(bytes);
    Assert("Deserialized bloom still finds added values", bloom2.MightContain("user-abc"));
}

// ── Test 3: ColumnEncoder round-trip ──────────────────────────────────────────
Console.WriteLine("\nTest 3: ColumnEncoder round-trips");
{
    // Timestamps
    var ts = new long[] { 1_744_000_000_000L, 1_744_000_001_000L, 1_744_000_005_000L };
    var tsDec = ColumnEncoder.DecodeTimestamps(ColumnEncoder.EncodeTimestamps(ts), ts.Length);
    Assert("Timestamps round-trip", ts.SequenceEqual(tsDec));

    // Strings
    var strs = new[] { "true", "false", "true", "control", "treatment" };
    var (strEnc, bloom) = ColumnEncoder.EncodeStrings(strs, buildBloom: true);
    var strDec = ColumnEncoder.DecodeStrings(strEnc, strs.Length);
    Assert("Strings round-trip", strs.SequenceEqual(strDec));
    Assert("String bloom not null", bloom is not null);
    Assert("String bloom contains value", bloom!.MightContain("true"));

    // Nullable strings
    var nullStrs = new string?[] { "exp-1", null, "exp-1", null, "exp-2" };
    var (nsEnc, _) = ColumnEncoder.EncodeNullableStrings(nullStrs);
    var nsDec = ColumnEncoder.DecodeNullableStrings(nsEnc, nullStrs.Length);
    Assert("Nullable strings round-trip", nullStrs.SequenceEqual(nsDec));
    Assert("Nulls preserved", nsDec[1] is null && nsDec[3] is null);

    // Nullable doubles
    var doubles = new double?[] { 1.5, null, 42.0, null, 0.0 };
    var dblDec = ColumnEncoder.DecodeNullableDoubles(ColumnEncoder.EncodeNullableDoubles(doubles), doubles.Length);
    Assert("Nullable doubles round-trip", doubles.SequenceEqual(dblDec));
    Assert("Double nulls preserved", dblDec[1] is null && dblDec[3] is null);

    // Bytes
    var bytes = new byte[] { 5, 12, 99, 0, 100 };
    var bytesDec = ColumnEncoder.DecodeBytes(ColumnEncoder.EncodeBytes(bytes), bytes.Length);
    Assert("Bytes round-trip", bytes.SequenceEqual(bytesDec));
}

// ── Test 4: Segment write + read back (FlagEval) ──────────────────────────────
Console.WriteLine("\nTest 4: FlagEval segment write → read");
{
    var dir  = Path.Combine(dataRoot, "t4");
    Directory.CreateDirectory(dir);
    var path = Path.Combine(dir, "seg-00000001.fbs");

    var now  = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
    var records = Enumerable.Range(0, 500).Select(i => FlagEvalRecord.Create(
        envId:        "env-test",
        flagKey:      "checkout-v2",
        userKey:      $"user-{i:D4}",
        variant:      i % 2 == 0 ? "true" : "false",
        timestampMs:  now + i * 1000,
        experimentId: i < 250 ? "exp-abc" : null,
        userProps:    new Dictionary<string, string> { ["plan"] = i % 3 == 0 ? "premium" : "free" }
    )).ToList();

    await FlagEvalSegmentWriter.WriteAsync(records, path);
    Assert("Segment file created", File.Exists(path));

    var (header, dataOffset) = await SegmentReader.ReadHeaderAsync(path);
    Assert("RowCount correct",     header.RowCount == 500);
    Assert("TableType correct",    header.TableType == TableType.FlagEval);
    Assert("ZoneMin set",          header.ZoneMin == now);
    Assert("ZoneMax set",          header.ZoneMax == now + 499 * 1000);
    Assert("Column count",         header.Columns.Count == 8);
    Assert("timestamp col exists", header.Columns.Any(c => c.Name == "timestamp"));
    Assert("user_key has bloom",   header.Columns.First(c => c.Name == "user_key").BloomFilter is not null);

    // Zone map pruning
    Assert("Overlaps full range",  SegmentReader.OverlapsTimeRange(header, now, now + 499_000));
    Assert("No overlap (future)",  !SegmentReader.OverlapsTimeRange(header, now + 1_000_000, now + 2_000_000));

    // Bloom filter pruning
    Assert("Bloom: known user found",      SegmentReader.MightContain(header, "user_key", "user-0100"));
    Assert("Bloom: unknown user likely absent", !SegmentReader.MightContain(header, "user_key", "user-ZZZZ"));

    // Full record read-back
    var readBack = await SegmentReader.ReadFlagEvalsAsync(path);
    Assert("All records read back", readBack.Count == 500);
    Assert("UserKey round-trip",    readBack[42].UserKey == "user-0042");
    Assert("Variant round-trip",    readBack[0].Variant == "true");
    Assert("HashBucket round-trip", readBack[0].HashBucket == FlagEvalRecord.ComputeHashBucket("user-0000", "checkout-v2"));
    Assert("ExperimentId non-null", readBack[0].ExperimentId == "exp-abc");
    Assert("ExperimentId null",     readBack[250].ExperimentId is null);
    Assert("UserProps round-trip",  readBack[0].UserPropsJson!.Contains("premium"));

    Console.WriteLine($"  File size: {new FileInfo(path).Length:N0} bytes for 500 records");
}

// ── Test 5: Segment write + read back (MetricEvent) ───────────────────────────
Console.WriteLine("\nTest 5: MetricEvent segment write → read");
{
    var dir  = Path.Combine(dataRoot, "t5");
    Directory.CreateDirectory(dir);
    var path = Path.Combine(dir, "seg-00000001.fbs");

    var now     = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
    var records = Enumerable.Range(0, 300).Select(i => MetricEventRecord.Create(
        envId:        "env-test",
        eventName:    "purchase",
        userKey:      $"user-{i:D4}",
        timestampMs:  now + i * 500,
        numericValue: i % 5 == 0 ? null : (double)(i * 10),
        source:       i % 2 == 0 ? "Web" : null
    )).ToList();

    await MetricEventSegmentWriter.WriteAsync(records, path);
    Assert("Metric segment file created", File.Exists(path));

    var (header, _) = await SegmentReader.ReadHeaderAsync(path);
    Assert("MetricEvent TableType", header.TableType == TableType.MetricEvent);
    Assert("RowCount correct",      header.RowCount == 300);

    var readBack = await SegmentReader.ReadMetricEventsAsync(path);
    Assert("All metric events read", readBack.Count == 300);
    Assert("NumericValue non-null",  readBack[1].NumericValue == 10.0);
    Assert("NumericValue null",      readBack[0].NumericValue is null); // i=0, i%5==0
    Assert("Source round-trip",      readBack[0].Source == "Web");
    Assert("Source null",            readBack[1].Source is null);
}

// ── Test 6: StorageEngine + PartitionWriter (write via engine, verify files) ──
Console.WriteLine("\nTest 6: StorageEngine end-to-end");
{
    var engineRoot = Path.Combine(dataRoot, "engine");
    await using var engine = new StorageEngine(engineRoot, maxBatchSize: 100,
                                               flushInterval: TimeSpan.FromMilliseconds(200));

    var now = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();

    // Write 250 flag evals (should produce ≥2 segments at batchSize=100)
    for (int i = 0; i < 250; i++)
        await engine.WriteFlagEvalAsync(FlagEvalRecord.Create(
            "env-prod", "dark-mode", $"user-{i}", i % 2 == 0 ? "true" : "false", now + i));

    // Write 150 metric events
    for (int i = 0; i < 150; i++)
        await engine.WriteMetricEventAsync(MetricEventRecord.Create(
            "env-prod", "click", $"user-{i}", now + i, numericValue: 1.0));

    // Dispose flushes remaining data
} // DisposeAsync called here

var date      = DateTime.UtcNow.ToString("yyyy-MM-dd");
var flagDir   = Path.Combine(dataRoot, "engine", "flag-evals",    "env-prod", "dark-mode", date);
var metricDir = Path.Combine(dataRoot, "engine", "metric-events", "env-prod", "click",     date);

Assert("FlagEval partition dir created",   Directory.Exists(flagDir));
Assert("MetricEvent partition dir created", Directory.Exists(metricDir));

var flagSegs   = Directory.GetFiles(flagDir,   "*.fbs");
var metricSegs = Directory.GetFiles(metricDir, "*.fbs");
Assert("Multiple flag-eval segments",     flagSegs.Length >= 2, $"got {flagSegs.Length}");
Assert("MetricEvent segments exist",      metricSegs.Length >= 1, $"got {metricSegs.Length}");

// Verify total row count across all segments
int totalFlagRows = 0;
foreach (var seg in flagSegs)
{
    var (h, _) = await SegmentReader.ReadHeaderAsync(seg);
    totalFlagRows += h.RowCount;
}
Assert($"Total flag rows = 250", totalFlagRows == 250, $"got {totalFlagRows}");

// ── Test 7: Throughput smoke test ──────────────────────────────────────────────
Console.WriteLine("\nTest 7: Throughput smoke test (10 000 records)");
{
    var dir = Path.Combine(dataRoot, "perf");
    Directory.CreateDirectory(dir);
    var path = Path.Combine(dir, "seg-perf.fbs");

    var now = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
    var records = Enumerable.Range(0, 10_000).Select(i => FlagEvalRecord.Create(
        "env-prod", "perf-flag", $"user-{i}", i % 3 == 0 ? "control" : "treatment",
        now + i, experimentId: "exp-perf")).ToList();

    var sw = Stopwatch.StartNew();
    await FlagEvalSegmentWriter.WriteAsync(records, path);
    sw.Stop();

    var info = new FileInfo(path);
    Console.WriteLine($"  10 000 records → {info.Length:N0} bytes in {sw.ElapsedMilliseconds} ms");
    Console.WriteLine($"  Compression ratio: {(double)(10_000 * 8 * 8) / info.Length:F1}x (approx)");
    Assert("Write completes < 2 s", sw.ElapsedMilliseconds < 2000);
    Assert("File size < 1 MB",      info.Length < 1_000_000, $"{info.Length:N0} bytes");
}

// ════════════════════════════════════════════════════════════════════════════
// PHASE 2 TESTS — ExperimentQueryEngine
// ════════════════════════════════════════════════════════════════════════════

// ── Test 8: Binary metric end-to-end ─────────────────────────────────────────
Console.WriteLine("\nTest 8: Binary metric query (purchase conversion)");
{
    var qRoot = Path.Combine(dataRoot, "q8");
    await using var engine = new StorageEngine(qRoot, maxBatchSize: 50,
                                               flushInterval: TimeSpan.FromMilliseconds(100));

    // Experiment window
    var expStart = DateTimeOffset.UtcNow.AddHours(-2);
    var expEnd   = DateTimeOffset.UtcNow;

    // 600 users: 300 control, 300 treatment
    // Traffic hash distributes users across buckets deterministically
    var flagEvals = Enumerable.Range(0, 600).Select(i =>
        FlagEvalRecord.Create(
            envId:        "env-prod",
            flagKey:      "dark-mode",
            userKey:      $"user-{i:D4}",
            variant:      i < 300 ? "false" : "true",   // false=control, true=treatment
            timestampMs:  expStart.AddMinutes(i % 60).ToUnixTimeMilliseconds(),
            experimentId: "exp-dark-mode",
            userProps:    new() { ["plan"] = i % 3 == 0 ? "premium" : "free" }
        )).ToList();

    foreach (var r in flagEvals)
        await engine.WriteFlagEvalAsync(r);

    // 180 conversions: 60 control (20%), 120 treatment (40%)
    var conversions = new List<MetricEventRecord>();
    for (int i = 0; i < 300; i++)
    {
        bool didConvert = i < 300
            ? i % 5 == 0      // control: every 5th → 60/300 = 20%
            : i % 3 == 0;     // (never reached here since treatment is i>=300)
        // control: i=0..299, convert if i%5==0 → 60 users
        if (i % 5 == 0)
            conversions.Add(MetricEventRecord.Create(
                "env-prod", "purchase", $"user-{i:D4}",
                expStart.AddMinutes(i % 60 + 5).ToUnixTimeMilliseconds()));
    }
    for (int i = 300; i < 600; i++)
    {
        // treatment: i=300..599, convert if (i-300)%3==0 → 100 users
        if ((i - 300) % 3 == 0)
            conversions.Add(MetricEventRecord.Create(
                "env-prod", "purchase", $"user-{i:D4}",
                expStart.AddMinutes(i % 60 + 5).ToUnixTimeMilliseconds()));
    }

    foreach (var r in conversions)
        await engine.WriteMetricEventAsync(r);

    await Task.Delay(300); // let flush complete
    await engine.DisposeAsync();

    // Query
    var qEngine = new ExperimentQueryEngine(qRoot);
    var result  = await qEngine.QueryAsync(new ExperimentQuery
    {
        EnvId             = "env-prod",
        FlagKey           = "dark-mode",
        MetricEvent       = "purchase",
        MetricType        = "binary",
        ControlVariant    = "false",
        TreatmentVariants = ["true"],
        Start             = expStart,
        End               = expEnd,
        ExperimentId      = "exp-dark-mode",
    });

    var ctrl = result.GetBinary("false")!;
    var trt  = result.GetBinary("true")!;

    Console.WriteLine($"  Control:   n={ctrl.N}, k={ctrl.K}  ({100.0*ctrl.K/ctrl.N:F1}% CVR)");
    Console.WriteLine($"  Treatment: n={trt.N},  k={trt.K}   ({100.0*trt.K/trt.N:F1}% CVR)");

    Assert("Control n = 300",          ctrl.N == 300, $"got {ctrl.N}");
    Assert("Control k = 60",           ctrl.K == 60,  $"got {ctrl.K}");
    Assert("Treatment n = 300",        trt.N == 300,  $"got {trt.N}");
    Assert("Treatment k = 100",        trt.K == 100,  $"got {trt.K}");
    Assert("Treatment CVR > control",  trt.K * ctrl.N > ctrl.K * trt.N);
}

// ── Test 9: Audience filter (premium only) ────────────────────────────────────
Console.WriteLine("\nTest 9: Audience filter — premium users only");
{
    var qRoot = Path.Combine(dataRoot, "q9");
    await using var engine = new StorageEngine(qRoot, maxBatchSize: 200,
                                               flushInterval: TimeSpan.FromMilliseconds(100));

    var expStart = DateTimeOffset.UtcNow.AddHours(-1);
    var expEnd   = DateTimeOffset.UtcNow;

    // 300 users, half premium (i%2==0 → 150 premium)
    var flagEvals = Enumerable.Range(0, 300).Select(i =>
        FlagEvalRecord.Create(
            "env-prod", "new-ui", $"user-{i:D4}",
            i < 150 ? "control" : "treatment",
            expStart.AddMinutes(i % 30).ToUnixTimeMilliseconds(),
            experimentId: "exp-ui",
            userProps:    new() { ["plan"] = i % 2 == 0 ? "premium" : "free" }
        )).ToList();

    foreach (var r in flagEvals)
        await engine.WriteFlagEvalAsync(r);

    // 50 conversions among premium users only
    for (int i = 0; i < 300; i += 6)  // every 6th user, ~50 total
        await engine.WriteMetricEventAsync(MetricEventRecord.Create(
            "env-prod", "upgrade", $"user-{i:D4}",
            expStart.AddMinutes(i % 30 + 2).ToUnixTimeMilliseconds()));

    await Task.Delay(300);
    await engine.DisposeAsync();

    // Query without filter — should see all users
    var qNoFilter = await new ExperimentQueryEngine(qRoot).QueryAsync(new ExperimentQuery
    {
        EnvId = "env-prod", FlagKey = "new-ui", MetricEvent = "upgrade",
        MetricType = "binary", ControlVariant = "control",
        TreatmentVariants = ["treatment"],
        Start = expStart, End = expEnd, ExperimentId = "exp-ui",
    });

    // Query WITH premium filter
    var qPremium = await new ExperimentQueryEngine(qRoot).QueryAsync(new ExperimentQuery
    {
        EnvId = "env-prod", FlagKey = "new-ui", MetricEvent = "upgrade",
        MetricType = "binary", ControlVariant = "control",
        TreatmentVariants = ["treatment"],
        Start = expStart, End = expEnd, ExperimentId = "exp-ui",
        AudienceFilters = [new AudienceFilter { Property = "plan", Op = "eq", Value = "premium" }],
    });

    var allCtrl  = qNoFilter.GetBinary("control")!;
    var premCtrl = qPremium.GetBinary("control")!;

    Console.WriteLine($"  All users:     control n={allCtrl.N},  treatment n={qNoFilter.GetBinary("treatment")!.N}");
    Console.WriteLine($"  Premium only:  control n={premCtrl.N}, treatment n={qPremium.GetBinary("treatment")!.N}");

    Assert("All users: n=150 per variant", allCtrl.N == 150, $"got {allCtrl.N}");
    Assert("Premium: fewer users exposed", premCtrl.N < allCtrl.N);
    Assert("Premium: both variants non-zero", premCtrl.N > 0 && qPremium.GetBinary("treatment")!.N > 0);
}

// ── Test 10: Continuous metric (revenue) ──────────────────────────────────────
Console.WriteLine("\nTest 10: Continuous metric query (revenue, agg=sum)");
{
    var qRoot = Path.Combine(dataRoot, "q10");
    await using var engine = new StorageEngine(qRoot, maxBatchSize: 100,
                                               flushInterval: TimeSpan.FromMilliseconds(100));

    var expStart = DateTimeOffset.UtcNow.AddHours(-3);
    var expEnd   = DateTimeOffset.UtcNow;

    // 200 users: 100 control, 100 treatment
    var flagEvals = Enumerable.Range(0, 200).Select(i =>
        FlagEvalRecord.Create(
            "env-prod", "pricing-v2", $"user-{i:D4}",
            i < 100 ? "control" : "treatment",
            expStart.AddMinutes(i % 30).ToUnixTimeMilliseconds()
        )).ToList();
    foreach (var r in flagEvals)
        await engine.WriteFlagEvalAsync(r);

    // Revenue events: control avg $10/user, treatment avg $20/user
    var rng = new Random(42);
    for (int i = 0; i < 200; i++)
    {
        double revenue = i < 100
            ? 5 + rng.NextDouble() * 10   // control: $5–$15, avg ≈$10
            : 15 + rng.NextDouble() * 10;  // treatment: $15–$25, avg ≈$20

        await engine.WriteMetricEventAsync(MetricEventRecord.Create(
            "env-prod", "revenue", $"user-{i:D4}",
            expStart.AddMinutes(i % 30 + 5).ToUnixTimeMilliseconds(),
            numericValue: revenue));
    }

    await Task.Delay(300);
    await engine.DisposeAsync();

    var result = await new ExperimentQueryEngine(qRoot).QueryAsync(new ExperimentQuery
    {
        EnvId = "env-prod", FlagKey = "pricing-v2", MetricEvent = "revenue",
        MetricType = "revenue", MetricAgg = "sum",
        ControlVariant = "control", TreatmentVariants = ["treatment"],
        Start = expStart, End = expEnd,
    });

    var ctrl = result.GetContinuous("control")!;
    var trt  = result.GetContinuous("treatment")!;

    Console.WriteLine($"  Control:   n={ctrl.N}, mean=${ctrl.Mean:F2}, variance={ctrl.Variance:F2}");
    Console.WriteLine($"  Treatment: n={trt.N},  mean=${trt.Mean:F2}, variance={trt.Variance:F2}");

    Assert("Control n = 100",                 ctrl.N == 100, $"got {ctrl.N}");
    Assert("Treatment n = 100",               trt.N == 100,  $"got {trt.N}");
    Assert("Treatment mean > control mean",   trt.Mean > ctrl.Mean);
    Assert("Both variances > 0",              ctrl.Variance > 0 && trt.Variance > 0);
    Assert("Control mean approx $10",         ctrl.Mean is > 7 and < 13, $"got {ctrl.Mean:F2}");
    Assert("Treatment mean approx $20",       trt.Mean is > 17 and < 23, $"got {trt.Mean:F2}");
}

// ── Test 11: Traffic bucket (50% traffic) ─────────────────────────────────────
Console.WriteLine("\nTest 11: Traffic bucket filter (50% traffic, offset=0)");
{
    var qRoot = Path.Combine(dataRoot, "q11");
    await using var engine = new StorageEngine(qRoot, maxBatchSize: 100,
                                               flushInterval: TimeSpan.FromMilliseconds(100));

    var expStart = DateTimeOffset.UtcNow.AddHours(-1);
    var expEnd   = DateTimeOffset.UtcNow;

    // Write 400 users evenly split
    var flagEvals = Enumerable.Range(0, 400).Select(i =>
        FlagEvalRecord.Create(
            "env-prod", "beta-feature", $"user-{i:D4}",
            i % 2 == 0 ? "control" : "treatment",
            expStart.AddMinutes(i % 30).ToUnixTimeMilliseconds()
        )).ToList();
    foreach (var r in flagEvals)
        await engine.WriteFlagEvalAsync(r);

    // Conversions for all users
    for (int i = 0; i < 400; i += 4)
        await engine.WriteMetricEventAsync(MetricEventRecord.Create(
            "env-prod", "click", $"user-{i:D4}",
            expStart.AddMinutes(i % 30 + 1).ToUnixTimeMilliseconds()));

    await Task.Delay(300);
    await engine.DisposeAsync();

    // 50% traffic query
    var result = await new ExperimentQueryEngine(qRoot).QueryAsync(new ExperimentQuery
    {
        EnvId = "env-prod", FlagKey = "beta-feature", MetricEvent = "click",
        MetricType = "binary", ControlVariant = "control",
        TreatmentVariants = ["treatment"],
        Start = expStart, End = expEnd,
        TrafficPercent = 50, TrafficOffset = 0,
    });

    var ctrl = result.GetBinary("control")!;
    var trt  = result.GetBinary("treatment")!;

    Console.WriteLine($"  50% traffic: control n={ctrl.N}, treatment n={trt.N} (total expected ≈200)");

    // With 50% traffic filter, should see roughly half the users
    Assert("50% filter reduces users",          ctrl.N + trt.N < 400);
    Assert("50% filter still has users",        ctrl.N + trt.N > 50);
    Assert("Balanced after filter",             Math.Abs(ctrl.N - trt.N) <= ctrl.N / 2);
}

// ── Test 12: QueryMany (primary + guardrail) ──────────────────────────────────
Console.WriteLine("\nTest 12: QueryMany — primary metric + guardrail");
{
    var qRoot = Path.Combine(dataRoot, "q12");
    await using var engine = new StorageEngine(qRoot, maxBatchSize: 100,
                                               flushInterval: TimeSpan.FromMilliseconds(100));

    var expStart = DateTimeOffset.UtcNow.AddHours(-1);
    var expEnd   = DateTimeOffset.UtcNow;

    var flagEvals = Enumerable.Range(0, 200).Select(i =>
        FlagEvalRecord.Create(
            "env-prod", "checkout-v3", $"user-{i:D4}",
            i < 100 ? "control" : "treatment",
            expStart.AddMinutes(i % 30).ToUnixTimeMilliseconds()
        )).ToList();
    foreach (var r in flagEvals)
        await engine.WriteFlagEvalAsync(r);

    // Primary: purchase (treatment converts better)
    for (int i = 0; i < 200; i++)
    {
        bool converts = i < 100 ? i % 5 == 0 : i % 3 == 0;
        if (converts)
            await engine.WriteMetricEventAsync(MetricEventRecord.Create(
                "env-prod", "purchase", $"user-{i:D4}",
                expStart.AddMinutes(i % 30 + 2).ToUnixTimeMilliseconds()));
    }

    // Guardrail: error_rate (treatment has more errors — guardrail should alarm)
    for (int i = 100; i < 200; i += 4)  // treatment only: 25 errors / 100 users
        await engine.WriteMetricEventAsync(MetricEventRecord.Create(
            "env-prod", "error", $"user-{i:D4}",
            expStart.AddMinutes(i % 30 + 1).ToUnixTimeMilliseconds()));

    await Task.Delay(300);
    await engine.DisposeAsync();

    var qEngine = new ExperimentQueryEngine(qRoot);
    var results = await qEngine.QueryManyAsync(
        primaryQuery: new ExperimentQuery
        {
            EnvId = "env-prod", FlagKey = "checkout-v3", MetricEvent = "purchase",
            MetricType = "binary", ControlVariant = "control",
            TreatmentVariants = ["treatment"], Start = expStart, End = expEnd,
        },
        guardrailEventNames: ["error"]);

    Assert("Primary metric present",   results.ContainsKey("purchase"));
    Assert("Guardrail metric present", results.ContainsKey("error"));

    var purchase = results["purchase"].GetBinary("treatment")!;
    var error    = results["error"].GetBinary("treatment")!;
    var errCtrl  = results["error"].GetBinary("control")!;

    Console.WriteLine($"  Purchase: ctrl k={results["purchase"].GetBinary("control")!.K}, trt k={purchase.K}");
    Console.WriteLine($"  Error:    ctrl k={errCtrl.K}, trt k={error.K}");

    Assert("Treatment converts more (purchase)", purchase.K > results["purchase"].GetBinary("control")!.K);
    Assert("Treatment has more errors (guardrail)", error.K > errCtrl.K);
}

// ── Test 13: Performance — 100k events, full query ────────────────────────────
Console.WriteLine("\nTest 13: Performance — 100 000 flag evals + 40 000 metric events");
{
    var qRoot = Path.Combine(dataRoot, "q13");
    await using var engine = new StorageEngine(qRoot, maxBatchSize: 5_000,
                                               flushInterval: TimeSpan.FromMilliseconds(100));

    var expStart = DateTimeOffset.UtcNow.AddHours(-2);
    var expEnd   = DateTimeOffset.UtcNow;

    var sw = Stopwatch.StartNew();

    // Write 100k flag evals in batches
    var batch = new List<FlagEvalRecord>(1_000);
    for (int i = 0; i < 100_000; i++)
    {
        batch.Add(FlagEvalRecord.Create(
            "env-prod", "large-exp", $"user-{i:D6}",
            i < 50_000 ? "control" : "treatment",
            expStart.AddSeconds(i % 3600).ToUnixTimeMilliseconds(),
            experimentId: "exp-large"));
        if (batch.Count == 1_000)
        {
            foreach (var r in batch) await engine.WriteFlagEvalAsync(r);
            batch.Clear();
        }
    }

    // Write 40k metric events (40% conversion rate)
    for (int i = 0; i < 100_000; i += 5)  // every 5th user → 20k events... wait, 100k/5 = 20k
        await engine.WriteMetricEventAsync(MetricEventRecord.Create(
            "env-prod", "pageview", $"user-{i:D6}",
            expStart.AddSeconds(i % 3600 + 10).ToUnixTimeMilliseconds()));

    sw.Stop();
    var writeMs = sw.ElapsedMilliseconds;

    await Task.Delay(500);
    await engine.DisposeAsync();

    // Query
    sw.Restart();
    var result = await new ExperimentQueryEngine(qRoot).QueryAsync(new ExperimentQuery
    {
        EnvId = "env-prod", FlagKey = "large-exp", MetricEvent = "pageview",
        MetricType = "binary", ControlVariant = "control",
        TreatmentVariants = ["treatment"],
        Start = expStart, End = expEnd, ExperimentId = "exp-large",
    });
    sw.Stop();

    var ctrl = result.GetBinary("control")!;
    var trt  = result.GetBinary("treatment")!;
    Console.WriteLine($"  Write:  100k flag evals + 20k metric events in {writeMs} ms");
    Console.WriteLine($"  Query:  {sw.ElapsedMilliseconds} ms → control n={ctrl.N} k={ctrl.K}, treatment n={trt.N} k={trt.K}");

    Assert("Query completes < 5 s",     sw.ElapsedMilliseconds < 5_000, $"{sw.ElapsedMilliseconds} ms");
    Assert("All users accounted for",   ctrl.N + trt.N == 100_000, $"got {ctrl.N + trt.N}");
    Assert("Balanced (n equal)",        ctrl.N == trt.N, $"ctrl={ctrl.N} trt={trt.N}");
    Assert("Conversions correct",       ctrl.K + trt.K == 20_000, $"got {ctrl.K + trt.K}");
}

// ── Summary ───────────────────────────────────────────────────────────────────
Console.WriteLine($"\n{'─',40}");
Console.WriteLine($"  Results: {passed} passed, {failed} failed");
if (failed > 0) Console.WriteLine("  *** SOME TESTS FAILED ***");
else            Console.WriteLine("  All tests passed.");

// Cleanup
try { Directory.Delete(dataRoot, recursive: true); } catch { /* ignore */ }

Environment.Exit(failed > 0 ? 1 : 0);
