/**
 * Smoke test for the pure functions in customer-endpoint-client.ts.
 *
 * Run:  npx tsx scripts/verify-customer-endpoint-client.ts
 *
 * No network, no DB. Verifies:
 *   - HMAC signature against a known test vector
 *   - SSRF guard rejects all the documented private/loopback/metadata forms
 *   - normaliseResponse handles binary, continuous (mean+stddev), continuous
 *     (sum+sum_squares), and rejects malformed shapes with clear errors
 */

import { createHmac } from "node:crypto";
import {
  signRequest,
  checkPrivateAddress,
  normaliseResponse,
} from "../src/lib/stats/customer-endpoint-client";

let failures = 0;
function check(label: string, ok: boolean, detail?: string) {
  if (ok) {
    console.log(`✓ ${label}`);
  } else {
    console.error(`✗ ${label}${detail ? ` — ${detail}` : ""}`);
    failures++;
  }
}

// ── HMAC test vector ─────────────────────────────────────────────────────────

{
  const secret = "fbsk_test_secret";
  const ts = 1735689600;
  const body = '{"hello":"world"}';
  const expected = `sha256=${createHmac("sha256", secret).update(`${ts}.${body}`, "utf8").digest("hex")}`;
  const actual = signRequest(secret, ts, body);
  check("HMAC matches reference", actual === expected, `expected=${expected} actual=${actual}`);
}

// ── SSRF guard ───────────────────────────────────────────────────────────────

const blockedUrls = [
  "https://localhost/foo",
  "https://example.local/foo",
  "https://127.0.0.1/foo",
  "https://10.5.5.5/foo",
  "https://192.168.1.1/foo",
  "https://172.16.0.1/foo",
  "https://172.31.255.255/foo",
  "https://169.254.169.254/foo",          // EC2/Azure IMDS
  "https://0.0.0.0/foo",
  "https://[::1]/foo",
  "https://[fe80::1]/foo",
  "https://[fc00::1]/foo",
  "http://example.com/foo",                // wrong protocol
  "not a url",                             // malformed
];
for (const u of blockedUrls) {
  const err = checkPrivateAddress(u);
  check(`SSRF blocks ${u}`, err !== null, `expected error, got null`);
}

const allowedUrls = [
  "https://stats.acme.example/featbit",
  "https://1.2.3.4/foo",                   // public IP — passes our static check
  "https://example.com",
];
for (const u of allowedUrls) {
  const err = checkPrivateAddress(u);
  check(`SSRF allows ${u}`, err === null, `unexpected error: ${err}`);
}

// ── normaliseResponse: happy paths ───────────────────────────────────────────

{
  const r = normaliseResponse({
    schemaVersion: 1,
    experimentId:  "exp_x",
    computedAt:    "2026-05-02T08:00:00Z",
    metrics: {
      conversion: {
        type: "binary", agg: "once",
        data: { control: { n: 100, k: 12 }, treatment: { n: 100, k: 18 } },
      },
    },
  });
  const ctrl = r.metrics.conversion.data.control;
  check("binary normalises to {n,k}", "k" in ctrl && ctrl.n === 100 && ctrl.k === 12);
}

{
  const r = normaliseResponse({
    schemaVersion: 1,
    experimentId:  "exp_x",
    computedAt:    "2026-05-02T08:00:00Z",
    metrics: {
      revenue: {
        type: "continuous", agg: "sum",
        data: { control: { n: 100, mean: 5.0, stddev: 2.0 } },
      },
    },
  });
  const ctrl = r.metrics.revenue.data.control;
  check(
    "continuous {n,mean,stddev} → {n,mean,variance=stddev²}",
    "variance" in ctrl && ctrl.n === 100 && ctrl.mean === 5.0 && Math.abs(ctrl.variance - 4.0) < 1e-9,
  );
}

{
  const r = normaliseResponse({
    schemaVersion: 1,
    experimentId:  "exp_x",
    computedAt:    "2026-05-02T08:00:00Z",
    metrics: {
      revenue: {
        type: "continuous", agg: "sum",
        data: { control: { n: 4, sum: 20, sum_squares: 120 } },
      },
    },
  });
  const ctrl = r.metrics.revenue.data.control;
  // mean=20/4=5; variance=(120 - 400/4)/3 = 20/3 ≈ 6.667
  check(
    "continuous {n,sum,sum_squares} → {n,mean,variance}",
    "variance" in ctrl && ctrl.n === 4 && ctrl.mean === 5 && Math.abs(ctrl.variance - 20 / 3) < 1e-9,
  );
}

// ── normaliseResponse: failure modes ─────────────────────────────────────────

const badResponses: { label: string; body: unknown }[] = [
  { label: "null body",         body: null },
  { label: "wrong schemaVersion", body: { schemaVersion: 2, experimentId: "x", computedAt: "y", metrics: {} } },
  { label: "missing computedAt", body: { schemaVersion: 1, experimentId: "x", metrics: {} } },
  { label: "metric.type invalid", body: {
      schemaVersion: 1, experimentId: "x", computedAt: "y",
      metrics: { m: { type: "ratio", agg: "once", data: {} } },
    },
  },
  { label: "continuous missing keys", body: {
      schemaVersion: 1, experimentId: "x", computedAt: "y",
      metrics: { m: { type: "continuous", agg: "sum", data: { control: { n: 10 } } } },
    },
  },
  { label: "n is NaN", body: {
      schemaVersion: 1, experimentId: "x", computedAt: "y",
      metrics: { m: { type: "binary", agg: "once", data: { control: { n: "ten", k: 1 } } } },
    },
  },
];
for (const t of badResponses) {
  let threw = false;
  try { normaliseResponse(t.body); } catch { threw = true; }
  check(`normaliseResponse rejects: ${t.label}`, threw);
}

// ── Summary ──────────────────────────────────────────────────────────────────

if (failures > 0) {
  console.error(`\n${failures} check(s) failed`);
  process.exit(1);
}
console.log(`\nAll checks passed`);
