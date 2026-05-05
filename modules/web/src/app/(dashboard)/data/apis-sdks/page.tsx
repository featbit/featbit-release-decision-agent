"use client";

import { useState } from "react";
import { Tabs } from "@base-ui/react/tabs";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import {
  EnvSecretCard,
  useCurrentEnvSecret,
} from "@/components/env-settings/env-secret-card";

/**
 * Rewrites the sample-code placeholders so the user can paste the snippet
 * straight into their project with no edits. `ENV_ID` is a variable reference
 * in the snippets, so it gets a quoted literal; `rat-env-v1` is already quoted
 * at every call site, so it gets the bare token.
 */
function withEnvSecret(text: string, envSecret: string | null): string {
  if (!envSecret) return text;
  return text
    .replaceAll("ENV_ID", JSON.stringify(envSecret))
    .replaceAll("rat-env-v1", envSecret);
}

// ── Page TOC ─────────────────────────────────────────────────────────────────

const SECTIONS = [
  { id: "get-started",   label: "Get Started"   },
  { id: "apis",          label: "APIs"          },
  { id: "sdks",          label: "SDKs"          },
  { id: "best-practice", label: "Best Practice" },
] as const;

type SectionId = (typeof SECTIONS)[number]["id"];

// Production track-service endpoint — the real ingest URL for A/B testing
// events. Distinct from FEATBIT_API_URL (which is the FeatBit backend, not
// track-service). Matches the default in track-client.ts.
const TRACK_BASE_URL = "https://track.featbit.ai";

// ── Per-SDK snippets for the SDKs section ────────────────────────────────────
// Pattern: (1) a project-internal helper trackFlagForExpt(user, variant),
// (2) call it right after the FeatBit SDK evaluation.

const SDK_SNIPPETS: Array<{
  id: string;
  label: string;
  lang: string;
  helper: string;
  usage: string;
}> = [
  {
    id: "node",
    label: "Node.js",
    lang: "ts",
    helper: `// lib/track.ts — wrap once, reuse everywhere
export async function trackFlagForExpt(
  user: { keyId: string; properties?: Record<string, string> },
  flagKey: string,
  variant: string,
  experimentId?: string,
) {
  await fetch(\`\${TRACK_URL}/api/track/event\`, {
    method:  "POST",
    headers: { "Content-Type": "application/json", Authorization: ENV_ID },
    body: JSON.stringify({
      user,
      variations: [{ flagKey, variant, timestamp: Date.now(), experimentId }],
    }),
  });
}`,
    usage: `import { UserBuilder } from "@featbit/node-server-sdk";
import { trackFlagForExpt } from "@/lib/track";

const user    = new UserBuilder("user-123").name("Alice").build();
const variant = (await fbClient.boolVariation("new-checkout", user, false))
  ? "treatment"
  : "control";

// ⬇ one-line report; same user.keyId flows through to metric events later
await trackFlagForExpt({ keyId: "user-123" }, "new-checkout", variant, "exp-checkout-q2");`,
  },
  {
    id: "dotnet",
    label: ".NET",
    lang: "csharp",
    helper: `// Services/ExperimentTracker.cs — wrap once, reuse everywhere
public sealed class ExperimentTracker(HttpClient http)
{
    public Task TrackFlagForExptAsync(
        string keyId, string flagKey, string variant, string? experimentId = null)
        => http.PostAsJsonAsync("http://track-service:8080/api/track/event", new {
            user       = new { keyId },
            variations = new[] { new {
                flagKey,
                variant,
                timestamp    = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds(),
                experimentId,
            } },
        });
}`,
    usage: `var user    = FbUser.Builder("user-123").Name("Alice").Build();
var variant = _fbClient.BoolVariation("new-checkout", user, defaultValue: false)
    ? "treatment"
    : "control";

// ⬇ one-line report; same keyId flows through to metric events later
await _tracker.TrackFlagForExptAsync("user-123", "new-checkout", variant, "exp-checkout-q2");`,
  },
  {
    id: "java",
    label: "Java",
    lang: "java",
    helper: `// ExperimentTracker.java — wrap once, reuse everywhere
public class ExperimentTracker {
    public void trackFlagForExpt(
            String keyId, String flagKey, String variant, String experimentId) throws Exception {
        var body = mapper.writeValueAsString(Map.of(
            "user",       Map.of("keyId", keyId),
            "variations", List.of(Map.of(
                "flagKey",      flagKey,
                "variant",      variant,
                "timestamp",    System.currentTimeMillis(),
                "experimentId", experimentId))));
        httpClient.send(HttpRequest.newBuilder()
            .uri(URI.create("http://track-service:8080/api/track/event"))
            .header("Authorization", "rat-env-v1")
            .header("Content-Type",  "application/json")
            .POST(HttpRequest.BodyPublishers.ofString(body))
            .build(), HttpResponse.BodyHandlers.discarding());
    }
}`,
    usage: `FBUser user    = new FBUser.Builder("user-123").userName("Alice").build();
String variant = client.boolVariation("new-checkout", user, false)
    ? "treatment"
    : "control";

// ⬇ one-line report; same keyId flows through to metric events later
tracker.trackFlagForExpt("user-123", "new-checkout", variant, "exp-checkout-q2");`,
  },
  {
    id: "go",
    label: "Go",
    lang: "go",
    helper: `// pkg/track/track.go — wrap once, reuse everywhere
func TrackFlagForExpt(keyId, flagKey, variant, experimentId string) error {
    body, _ := json.Marshal(map[string]any{
        "user": map[string]any{"keyId": keyId},
        "variations": []map[string]any{{
            "flagKey":      flagKey,
            "variant":      variant,
            "timestamp":    time.Now().UnixMilli(),
            "experimentId": experimentId,
        }},
    })
    req, _ := http.NewRequest("POST", "http://track-service:8080/api/track/event", bytes.NewReader(body))
    req.Header.Set("Authorization", "rat-env-v1")
    req.Header.Set("Content-Type",  "application/json")
    _, err := http.DefaultClient.Do(req)
    return err
}`,
    usage: `user, _ := featbit.NewUserBuilder("user-123").UserName("Alice").Build()
enabled, _, _ := client.BoolVariation("new-checkout", user, false)
variant := "control"
if enabled {
    variant = "treatment"
}

// ⬇ one-line report; same keyId flows through to metric events later
track.TrackFlagForExpt("user-123", "new-checkout", variant, "exp-checkout-q2")`,
  },
  {
    id: "python",
    label: "Python",
    lang: "py",
    helper: `# track.py — wrap once, reuse everywhere
def track_flag_for_expt(key_id, flag_key, variant, experiment_id=None):
    requests.post(
        "http://track-service:8080/api/track/event",
        headers={"Authorization": "rat-env-v1"},
        json={
            "user":       {"keyId": key_id},
            "variations": [{
                "flagKey":      flag_key,
                "variant":      variant,
                "timestamp":    int(time.time() * 1000),
                "experimentId": experiment_id,
            }],
        },
    )`,
    usage: `from track import track_flag_for_expt

user    = {"key": "user-123", "name": "Alice"}
variant = "treatment" if client.variation("new-checkout", user, default=False) else "control"

# ⬇ one-line report; same key_id flows through to metric events later
track_flag_for_expt("user-123", "new-checkout", variant, "exp-checkout-q2")`,
  },
  {
    id: "js",
    label: "Browser JS",
    lang: "js",
    helper: `// lib/track.js — wrap once, reuse everywhere
export async function trackFlagForExpt(keyId, flagKey, variant, experimentId) {
  await fetch("/api/track/event", {
    method:  "POST",
    headers: { "Content-Type": "application/json", Authorization: ENV_ID },
    body: JSON.stringify({
      user: { keyId },
      variations: [{ flagKey, variant, timestamp: Date.now(), experimentId }],
    }),
  });
}`,
    usage: `import { trackFlagForExpt } from "./lib/track.js";

// User is bound at fbClient.init(); no per-call user arg
const variant = (await fbClient.boolVariation("new-checkout", false))
  ? "treatment"
  : "control";

// ⬇ one-line report; same keyId flows through to metric events later
await trackFlagForExpt(currentUserId, "new-checkout", variant, "exp-checkout-q2");`,
  },
  {
    id: "react",
    label: "React",
    lang: "jsx",
    helper: `// hooks/useFlagForExpt.ts — wrap once, reuse everywhere
export function useFlagForExpt(flagKey: string, experimentId?: string) {
  const flags   = useFlags();
  const { keyId } = useUser();
  const variant = flags[flagKey] ? "treatment" : "control";

  useEffect(() => {
    fetch("/api/track/event", {
      method:  "POST",
      headers: { "Content-Type": "application/json", Authorization: ENV_ID },
      body: JSON.stringify({
        user: { keyId },
        variations: [{ flagKey, variant, timestamp: Date.now(), experimentId }],
      }),
    });
  }, [keyId, flagKey, variant, experimentId]);

  return variant;
}`,
    usage: `function Checkout() {
  // ⬇ hook returns the variant AND records the exposure in one call
  const variant = useFlagForExpt("new-checkout", "exp-checkout-q2");

  return variant === "treatment" ? <NewCheckout /> : <LegacyCheckout />;
}`,
  },
];

// ── Page ─────────────────────────────────────────────────────────────────────

export default function ApisSdksPage() {
  const [active, setActive] = useState<SectionId>(SECTIONS[0].id);
  const { envSecret } = useCurrentEnvSecret();

  return (
    // Concrete viewport-derived height — the dashboard layout's flex chain
    // doesn't propagate a definite height down (SidebarProvider uses
    // min-h-svh, and the children wrapper lacks min-h-0), so h-full alone
    // would let this page grow with content and bubble scrolling up to
    // <main>. Pin to viewport minus the 44px (h-11) sticky header instead.
    <div className="flex h-[calc(100svh-2.75rem)]">
      <nav className="w-56 shrink-0 border-r border-border p-6 overflow-y-auto">
        <div className="text-xs uppercase tracking-wide text-muted-foreground mb-2 font-medium">
          Sections
        </div>
        <ul className="space-y-0.5">
          {SECTIONS.map((s) => (
            <li key={s.id}>
              <button
                type="button"
                onClick={() => setActive(s.id)}
                className={cn(
                  "w-full text-left block px-3 py-1.5 text-sm rounded-md border-l-2 transition-colors cursor-pointer",
                  active === s.id
                    ? "border-foreground text-foreground bg-muted font-medium"
                    : "border-transparent text-muted-foreground hover:text-foreground hover:bg-muted/50",
                )}
              >
                {s.label}
              </button>
            </li>
          ))}
        </ul>
      </nav>

      {/* Right pane — the only vertically scrolling region */}
      <div className="flex-1 min-w-0 overflow-y-auto">
        <div className="max-w-4xl p-6">
          {active === "get-started"   && <GetStartedSection   onNavigate={setActive} />}
          {active === "apis"          && <ApisSection          envSecret={envSecret} />}
          {active === "sdks"          && <SdksSection          envSecret={envSecret} />}
          {active === "best-practice" && <BestPracticeSection />}
        </div>
      </div>
    </div>
  );
}

// ── Section: Get Started ─────────────────────────────────────────────────────

function GetStartedSection({ onNavigate }: { onNavigate: (id: SectionId) => void }) {
  const linkCls =
    "underline underline-offset-2 hover:text-foreground cursor-pointer";
  return (
    <section className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold">Get Started</h2>
        <p className="text-sm text-muted-foreground max-w-2xl mt-1">
          The four steps of running an experiment on this platform, and where
          to go for the implementation details of each.
        </p>
      </div>

      <ol className="space-y-6">
        {/* Step 1 */}
        <li className="flex gap-4">
          <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-muted text-sm font-medium">
            1
          </div>
          <div className="flex-1 space-y-1 pt-0.5">
            <div className="font-medium text-sm">
              You have a hypothesis. You open an experiment.
            </div>
            <p className="text-sm text-muted-foreground">
              This is the starting point — nothing to instrument yet.
            </p>
          </div>
        </li>

        {/* Step 2 */}
        <li className="flex gap-4">
          <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-muted text-sm font-medium">
            2
          </div>
          <div className="flex-1 space-y-2 pt-0.5">
            <div className="font-medium text-sm">
              You split traffic with a feature flag, and record every flag
              evaluation back to the platform.
            </div>
            <p className="text-sm text-muted-foreground">
              Who saw control, who saw treatment — the experiment can&apos;t
              tell the variants apart unless each evaluation is reported. One
              call per evaluation site.
            </p>
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm pt-1">
              <button type="button" onClick={() => onNavigate("apis")} className={linkCls}>
                → APIs (raw HTTP)
              </button>
              <button type="button" onClick={() => onNavigate("sdks")} className={linkCls}>
                → SDKs (one-liner per language)
              </button>
            </div>
          </div>
        </li>

        {/* Step 3 */}
        <li className="flex gap-4">
          <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-muted text-sm font-medium">
            3
          </div>
          <div className="flex-1 space-y-2 pt-0.5">
            <div className="font-medium text-sm">
              You record the metric data that decides success — conversion
              rate, average duration, total revenue, etc.
            </div>
            <p className="text-sm text-muted-foreground">
              One event per moment that matters (checkout done, page loaded,
              purchase made). Metric events have their own shape, separate
              from flag evaluations.
            </p>
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm pt-1">
              <button type="button" onClick={() => onNavigate("apis")} className={linkCls}>
                → APIs (metric events)
              </button>
              <span className="text-xs text-muted-foreground">
                The SDKs section covers flag evaluation only. Metric events
                always go through the raw API.
              </span>
            </div>
          </div>
        </li>

        {/* Step 4 */}
        <li className="flex gap-4">
          <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-muted text-sm font-medium">
            4
          </div>
          <div className="flex-1 space-y-1 pt-0.5">
            <div className="font-medium text-sm">
              Events flow into your experiment data pool. When the run ends,
              the analysis engine reads them and produces the result.
            </div>
            <p className="text-sm text-muted-foreground">
              You don&apos;t touch the pool or the analyzer — both are
              handled. Your job was steps 2 and 3.
            </p>
          </div>
        </li>
      </ol>

      {/* Visual summary */}
      <div className="pt-2">
        <div className="text-xs text-muted-foreground mb-2 font-medium">
          The whole flow at a glance
        </div>
        <pre className="px-4 py-3 rounded bg-muted font-mono text-xs overflow-x-auto leading-relaxed">{`  ┌──────────────────────┐
  │      your app        │
  │                      │
  │  ② flag evaluated ───┼──►  POST /api/track/event    ┐
  │                      │     { user, variations }      │
  │                      │                                ├──►  experiment data pool
  │  ③ user converted ───┼──►  POST /api/track/event    │
  │                      │     { user, metrics }         ┘          │
  └──────────────────────┘                                            │
                                                                      ▼
                                               ④ analysis engine  ──►  result`}</pre>
        <p className="text-xs text-muted-foreground mt-2">
          ① happens in your head (hypothesis). ② and ③ are code you write —
          that&apos;s what the rest of this page is about. ④ is automatic.
        </p>
      </div>
    </section>
  );
}

// ── Section: APIs ────────────────────────────────────────────────────────────

function ApisSection({ envSecret }: { envSecret: string | null }) {
  return (
    <section className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold">APIs</h2>
        <p className="text-sm text-muted-foreground max-w-2xl mt-1">
          The HTTP surface of <strong>track-service</strong>, FeatBit&apos;s
          managed data warehouse for experiment events.{" "}
          <code>POST /api/track/event</code> sends one event;{" "}
          <code>POST /api/track</code> sends a batch (array of the same body).
        </p>
      </div>

      <EnvSecretCard />

      <Card>
        <CardHeader>
          <CardTitle>Base URL</CardTitle>
          <CardDescription>
            The managed track-service endpoint. The{" "}
            <code>Authorization</code> header carries your env secret
            (see card above).
          </CardDescription>
        </CardHeader>
        <CardContent>
          <code className="block px-3 py-2 rounded bg-muted font-mono text-xs">
            {TRACK_BASE_URL}
          </code>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Recording Traffic Events</CardTitle>
          <CardDescription>
            One <code>variations[]</code> entry per flag evaluation. The
            same <code>user.keyId</code> on the metric event later is what
            lets the query layer attribute conversions back to the variant.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <pre className="px-3 py-2 rounded bg-muted font-mono text-xs overflow-x-auto">{withEnvSecret(`curl -X POST ${TRACK_BASE_URL}/api/track/event \\
  -H "Authorization: rat-env-v1" \\
  -H "Content-Type: application/json" \\
  -d '{
    "user": {
      "keyId": "user-123",                  // required, stable user id — THE join key with metric events
      "properties": { "country": "US" }     // optional flat map; lets you slice results later (country, plan, platform…)
    },
    "variations": [{
      "flagKey":      "new-checkout",       // required — must match the flag key analyzed downstream
      "variant":      "treatment",          // required — usually "control" / "treatment"; any string your experiment configures
      "timestamp":    1776300000000,        // exposure time, epoch ms (Date.now()). Analysis uses the FIRST exposure; later ones are ignored
      "experimentId": "exp-checkout-q2",    // optional — set only when this exposure attributes to a specific run
      "layerId":      "checkout-layer"      // optional — for mutually-exclusive layers (a user is in at most one experiment per layer)
    }]
  }'`, envSecret)}</pre>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Recording Metric Events</CardTitle>
          <CardDescription>
            Same endpoint. Two contracts: <code>user.keyId</code> must match
            the one used at exposure, and <code>metric.timestamp</code> must
            be <code>≥</code> the exposure timestamp.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5 text-sm">
          <div className="space-y-2">
            <div className="font-medium">Conversion rate (binary event)</div>
            <p className="text-muted-foreground">
              Fire the event once, no <code>numericValue</code>. Denominator
              is users exposed; numerator is users who fired the event at
              least once post-exposure.
            </p>
            <pre className="px-3 py-2 rounded bg-muted font-mono text-xs overflow-x-auto">{withEnvSecret(`curl -X POST ${TRACK_BASE_URL}/api/track/event \\
  -H "Authorization: rat-env-v1" \\
  -H "Content-Type: application/json" \\
  -d '{
    "user": {
      "keyId": "user-123"                   // MUST match the keyId used at exposure, or attribution drops the event
    },
    "metrics": [{
      "eventName": "checkout-completed",    // required — must match the metric configured on the experiment
      "timestamp": 1776300060000            // event time, epoch ms; must be ≥ exposure timestamp or it will not be attributed
    }]
  }'`, envSecret)}</pre>
          </div>

          <div className="space-y-2">
            <div className="font-medium">Revenue (continuous value)</div>
            <p className="text-muted-foreground">
              Fire the event per transaction and put the amount in{" "}
              <code>numericValue</code>. Pick a consistent unit (cents, or
              primary currency unit) — stats-service sums as-is.
            </p>
            <pre className="px-3 py-2 rounded bg-muted font-mono text-xs overflow-x-auto">{withEnvSecret(`curl -X POST ${TRACK_BASE_URL}/api/track/event \\
  -H "Authorization: rat-env-v1" \\
  -H "Content-Type: application/json" \\
  -d '{
    "user": { "keyId": "user-123" },
    "metrics": [{
      "eventName":    "purchase",
      "timestamp":    1776300060000,
      "numericValue": 42.50                 // quantity (consistent unit) — omit for binary conversion events
    }]
  }'`, envSecret)}</pre>
          </div>

          <div className="space-y-2">
            <div className="font-medium">Duration / latency</div>
            <p className="text-muted-foreground">
              Same shape as revenue. Put the duration in{" "}
              <code>numericValue</code> (milliseconds is the convention across
              stats-service).
            </p>
            <pre className="px-3 py-2 rounded bg-muted font-mono text-xs overflow-x-auto">{withEnvSecret(`curl -X POST ${TRACK_BASE_URL}/api/track/event \\
  -H "Authorization: rat-env-v1" \\
  -H "Content-Type: application/json" \\
  -d '{
    "user": { "keyId": "user-123" },
    "metrics": [{
      "eventName":    "page-load",
      "timestamp":    1776300060000,
      "numericValue": 842                   // duration in ms (the stats-service convention)
    }]
  }'`, envSecret)}</pre>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Timestamp rule</CardTitle>
          <CardDescription>
            All timestamps are epoch milliseconds (<code>Date.now()</code> in
            JS). The query layer attributes each user to their <em>first</em>
            {" "}exposure and only counts metric events where{" "}
            <code>metric.timestamp ≥ exposure.timestamp</code>. Events that
            arrive out of order are dropped from attribution — make sure
            your SDK does not backdate metric timestamps.
          </CardDescription>
        </CardHeader>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>What happens after ingest</CardTitle>
          <CardDescription>
            Track-service writes into a bounded in-memory queue
            (<code>100k</code> events) and flushes to ClickHouse every{" "}
            <code>5s</code> or <code>1000</code> events. Flag exposures land
            in <code>featbit.flag_evaluations</code>; metric events land in{" "}
            <code>featbit.metric_events</code>. Both tables are queried by
            stats-service when you analyze a run.
          </CardDescription>
        </CardHeader>
      </Card>
    </section>
  );
}

// ── Section: SDKs ────────────────────────────────────────────────────────────

function SdksSection({ envSecret }: { envSecret: string | null }) {
  return (
    <section className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold">SDKs</h2>
        <p className="text-sm text-muted-foreground max-w-2xl mt-1">
          How to record <code>flag_evaluation</code> correctly from code that
          already uses a FeatBit SDK. Two rules that apply regardless of
          language.
        </p>
      </div>

      <EnvSecretCard />

      <Card>
        <CardHeader>
          <CardTitle>Two rules</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <div className="flex items-start gap-3">
            <Badge className="mt-0.5">1</Badge>
            <div>
              <div className="font-medium">Wrap the track API in a project-internal helper</div>
              <div className="text-muted-foreground">
                Do not open-code a <code>fetch(...)</code> at each flag site.
                Wrap it once — name it{" "}
                <code>trackFlagForExpt(user, variant)</code> or similar —
                so every call site is a one-liner, the URL/envId are in one
                place, and you can swap the transport later (batch,
                fire-and-forget, queue) without touching business code.
              </div>
            </div>
          </div>
          <div className="flex items-start gap-3">
            <Badge className="mt-0.5">2</Badge>
            <div>
              <div className="font-medium">
                Call <code>trackFlagForExpt(user, variant)</code> immediately
                after <code>.boolVariation()</code> (or the SDK equivalent)
              </div>
              <div className="text-muted-foreground">
                Exposure is the moment the variant influences behavior, not
                the moment the feature renders. Fire the track call in the
                same code path, with the same <code>user.keyId</code> the SDK
                evaluated against. For scenarios where FeatBit has no SDK,
                use the raw APIs from the previous section and still wrap
                them the same way.
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Per-language examples</CardTitle>
          <CardDescription>
            Each tab shows (1) the helper you put in one shared file, (2) how
            the call site looks right after the FeatBit SDK evaluation.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Tabs.Root defaultValue={SDK_SNIPPETS[0].id}>
            <Tabs.List className="relative flex flex-wrap gap-1 border-b border-border">
              {SDK_SNIPPETS.map((s) => (
                <Tabs.Tab
                  key={s.id}
                  value={s.id}
                  className="px-3 py-1.5 text-xs font-medium text-muted-foreground border-b-2 border-transparent rounded-t hover:text-foreground data-[active]:text-foreground data-[active]:font-semibold data-[active]:border-foreground -mb-px cursor-pointer"
                >
                  {s.label}
                </Tabs.Tab>
              ))}
            </Tabs.List>
            {SDK_SNIPPETS.map((s) => (
              <Tabs.Panel key={s.id} value={s.id} className="pt-4 space-y-4">
                <div>
                  <div className="text-xs text-muted-foreground mb-1">
                    <span className="font-medium">① Helper</span> — once per
                    project ({s.lang})
                  </div>
                  <pre className="px-3 py-2 rounded bg-muted font-mono text-xs overflow-x-auto">
                    {withEnvSecret(s.helper, envSecret)}
                  </pre>
                </div>
                <div>
                  <div className="text-xs text-muted-foreground mb-1">
                    <span className="font-medium">② Call site</span> — right
                    after evaluation
                  </div>
                  <pre className="px-3 py-2 rounded bg-muted font-mono text-xs overflow-x-auto">
                    {withEnvSecret(s.usage, envSecret)}
                  </pre>
                </div>
              </Tabs.Panel>
            ))}
          </Tabs.Root>
        </CardContent>
      </Card>
    </section>
  );
}

// ── Section: Best Practice ───────────────────────────────────────────────────

function BestPracticeSection() {
  return (
    <section className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold">Best Practice</h2>
        <p className="text-sm text-muted-foreground max-w-2xl mt-1">
          Three places the <code>flag_evaluation</code> record can live. Pick
          based on where your analysis is going to run, not where your flag
          service is.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Decision matrix</CardTitle>
          <CardDescription>
            What to do given what you already own.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b">
                  <th className="text-left font-medium py-2 pr-3">You have…</th>
                  <th className="text-left font-medium py-2 pr-3">You want…</th>
                  <th className="text-left font-medium py-2">Record to</th>
                </tr>
              </thead>
              <tbody className="text-muted-foreground">
                <tr className="border-b">
                  <td className="py-2 pr-3">FeatBit flags only</td>
                  <td className="py-2 pr-3">Variant distribution, flag health, nothing about business metrics</td>
                  <td className="py-2"><strong className="text-foreground">FeatBit flag-evaluation insights</strong></td>
                </tr>
                <tr className="border-b">
                  <td className="py-2 pr-3">FeatBit flags + want managed analysis</td>
                  <td className="py-2 pr-3">Full experiment analysis without building your own warehouse</td>
                  <td className="py-2"><strong className="text-foreground">FeatBit data warehouse (track-service)</strong></td>
                </tr>
                <tr>
                  <td className="py-2 pr-3">Your own data warehouse + FeatBit flags</td>
                  <td className="py-2 pr-3">Experiment analysis sitting next to your other product data</td>
                  <td className="py-2"><strong className="text-foreground">Your own warehouse</strong></td>
                </tr>
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Option A — FeatBit flag-evaluation insights</CardTitle>
          <CardDescription>
            Zero app instrumentation. FeatBit records every flag evaluation
            server-side; insights dashboards show variant distribution, flag
            reach, rule hits.
          </CardDescription>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground space-y-2">
          <p>
            <strong className="text-foreground">Use when:</strong> you need to
            answer &ldquo;is the flag firing and who&apos;s getting which
            variant&rdquo; — not &ldquo;did the variant change business
            metrics&rdquo;. No <code>flag_evaluation</code> event needs to
            leave the FeatBit stack; no metric events exist in this world.
          </p>
          <p>
            <strong className="text-foreground">Trade-off:</strong> you cannot
            do cross-metric analysis (conversion / revenue / duration by
            variant) because business metrics don&apos;t live here. The
            moment you need that, switch to option B or C.
          </p>
          <p className="text-xs">
            Pointer: the <code>featbit-opentelemetry</code> and{" "}
            <code>featbit-deployment-*</code> agent skills, plus the
            docs.featbit.co pages on flag-evaluation insights.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Option B — FeatBit data warehouse (track-service)</CardTitle>
          <CardDescription>
            What the rest of this page documents. Record both
            flag_evaluation and metric events to track-service; stats-service
            runs the analysis for you.
          </CardDescription>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground space-y-2">
          <p>
            <strong className="text-foreground">Use when:</strong> you want
            experiment analysis but don&apos;t want to stand up a warehouse.
            Follow the SDKs section for flag_evaluation and the APIs section
            for metric events. Both land in ClickHouse, joined by{" "}
            <code>user.keyId</code>, queryable from the run-analysis UI.
          </p>
          <p>
            <strong className="text-foreground">Trade-off:</strong> the raw
            event data lives in FeatBit, not in your warehouse. Cross-system
            analysis (joining experiment events against your CRM, billing,
            support data) requires an export.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Option C — your own data warehouse</CardTitle>
          <CardDescription>
            You already have Snowflake / BigQuery / Redshift / ClickHouse and
            want experiment events to land there so they sit next to every
            other product signal.
          </CardDescription>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground space-y-2">
          <p>
            <strong className="text-foreground">Use when:</strong> your
            analytics team already lives in a warehouse and FeatBit is only
            the flag-decision service. Skip track-service entirely.
          </p>
          <p>
            <strong className="text-foreground">How:</strong> keep the same
            two-rule pattern from the SDKs section, but point{" "}
            <code>trackFlagForExpt</code> at your own collector (Segment,
            RudderStack, Kafka topic, warehouse-ingest endpoint) instead of{" "}
            <code>/api/track/event</code>. The payload fields are yours to
            define; the invariant that survives is{" "}
            <em>same <code>user.keyId</code> on exposure and metric</em>.
          </p>
          <p>
            <strong className="text-foreground">Trade-off:</strong> you own
            the schema, the ingestion pipeline, and the analysis layer. You
            lose stats-service — your analysts write the SQL.
          </p>
        </CardContent>
      </Card>
    </section>
  );
}
