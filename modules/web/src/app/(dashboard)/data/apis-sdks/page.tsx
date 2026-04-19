import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

export default function ApisSdksPage() {
  return (
    <div className="p-6 max-w-4xl mx-auto space-y-6">
      <header className="space-y-1">
        <h1 className="text-lg font-semibold">APIs &amp; SDKs</h1>
        <p className="text-sm text-muted-foreground max-w-2xl">
          How to record <code className="px-1 rounded bg-muted">flag_evaluation</code>{" "}
          and <code className="px-1 rounded bg-muted">metric</code> events from
          your app. All events flow through <strong>track-service</strong>,
          which batches them into ClickHouse for experiment analysis.
        </p>
      </header>

      <Card>
        <CardHeader>
          <CardTitle>Base URL &amp; auth</CardTitle>
          <CardDescription>
            Track-service exposes two ingest endpoints. The environment ID goes
            in the <code>Authorization</code> header — it identifies which
            FeatBit environment the events belong to.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <div className="space-y-1">
            <div className="text-muted-foreground">Local (docker-compose):</div>
            <code className="block px-3 py-2 rounded bg-muted font-mono text-xs">
              http://localhost:5050
            </code>
          </div>
          <div className="space-y-1">
            <div className="text-muted-foreground">In-cluster:</div>
            <code className="block px-3 py-2 rounded bg-muted font-mono text-xs">
              http://track-service:8080
            </code>
          </div>
          <div className="space-y-1">
            <div className="text-muted-foreground">Header:</div>
            <code className="block px-3 py-2 rounded bg-muted font-mono text-xs">
              Authorization: &lt;envId&gt;
            </code>
            <p className="text-xs text-muted-foreground">
              The <code>Authorization</code> header value is taken as-is and
              used as the ClickHouse partition key (<code>env_id</code>). It
              is <strong>not</strong> verified today — any string works
              locally. A real auth check is on the roadmap. Examples below use{" "}
              <code>rat-env-v1</code>, which is the envId the bundled
              run-active-test worker writes under.
            </p>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>The two endpoints</CardTitle>
          <CardDescription>
            There is <strong>no per-event-type endpoint</strong>. Both{" "}
            <code>flag_evaluation</code> and <code>metric</code> events go
            through the same two ingest routes — what makes it a flag-eval
            event vs. a metric event is which field of the payload you fill
            in.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          <div className="flex items-start gap-2">
            <Badge>POST</Badge>
            <div>
              <code className="font-mono">/api/track</code>
              <span className="text-muted-foreground">
                {" "}
                — batch. Body is an array of <code>TrackPayload</code>. Use
                this from SDKs that buffer events and flush periodically.
              </span>
            </div>
          </div>
          <div className="flex items-start gap-2">
            <Badge>POST</Badge>
            <div>
              <code className="font-mono">/api/track/event</code>
              <span className="text-muted-foreground">
                {" "}
                — single. Body is one <code>TrackPayload</code>. Handy from
                scripts, webhooks, or servers that only have one event at a
                time.
              </span>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Tracking flag_evaluation</CardTitle>
          <CardDescription>
            Fill <code>variations</code>, leave <code>metrics</code> out.
            <code>variations</code> is an array because one call may cover
            multiple flags evaluated together (e.g. page load evaluates 3
            flags at once) — for a single flag, pass a one-element array.
            <code>experimentId</code> is optional and only needed when the
            exposure should be attributed to a specific experiment; for plain
            feature-flag rollouts, omit it.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <pre className="px-3 py-2 rounded bg-muted font-mono text-xs overflow-x-auto">{`curl -X POST http://localhost:5050/api/track/event \\
  -H "Authorization: rat-env-v1" \\
  -H "Content-Type: application/json" \\
  -d '{
    "user": {
      "keyId": "user-123",
      "properties": { "country": "US" }
    },
    "variations": [
      {
        "flagKey":   "new-checkout",
        "variant":   "treatment",
        "timestamp": 1776300000000
      }
    ]
  }'`}</pre>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Tracking metric events</CardTitle>
          <CardDescription>
            Fill <code>metrics</code>, leave <code>variations</code> out.
            These are the conversions / revenue / duration events you want to
            measure against the flag exposures.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <pre className="px-3 py-2 rounded bg-muted font-mono text-xs overflow-x-auto">{`curl -X POST http://localhost:5050/api/track/event \\
  -H "Authorization: rat-env-v1" \\
  -H "Content-Type: application/json" \\
  -d '{
    "user": { "keyId": "user-123" },
    "metrics": [
      {
        "eventName":    "checkout-completed",
        "timestamp":    1776300060000,
        "numericValue": 42.5
      }
    ]
  }'`}</pre>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Payload shape</CardTitle>
          <CardDescription>
            One payload is one user plus any mix of <code>variations</code>{" "}
            (flag exposures) and <code>metrics</code> (conversions). In
            practice they are sent separately — a flag evaluation fires at
            exposure time, while the metric event fires later when the user
            converts.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <pre className="px-3 py-2 rounded bg-muted font-mono text-xs overflow-x-auto">{`{
  "user": {
    "keyId": "string",                 // required, stable user id
    "properties": { "k": "v" }         // optional, stored as JSON
  },
  "variations": [
    {
      "flagKey":      "string",        // required
      "variant":      "string",        // required, e.g. "control" | "treatment"
      "timestamp":    1776300000000,   // epoch ms
      "experimentId": "string",        // optional
      "layerId":      "string"         // optional
    }
  ],
  "metrics": [
    {
      "eventName":    "string",        // required, e.g. "checkout-completed"
      "timestamp":    1776300060000,   // epoch ms
      "numericValue": 42.5,            // optional, for revenue / duration
      "type":         "string"         // optional
    }
  ]
}`}</pre>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Timestamp rule</CardTitle>
          <CardDescription>
            All timestamps are epoch milliseconds (
            <code>Date.now()</code> in JS). The query layer attributes each
            user to their <em>first</em> exposure and only counts metric events
            where <code>metric.timestamp ≥ exposure.timestamp</code>. Events
            that arrive out of order will be dropped from attribution — make
            sure your SDK does not backdate metric timestamps.
          </CardDescription>
        </CardHeader>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>What happens after ingest</CardTitle>
          <CardDescription>
            Track-service writes into a bounded in-memory queue
            (<code>100k</code> events) and flushes to ClickHouse every{" "}
            <code>5s</code> or <code>1000</code> events. Flag exposures land in{" "}
            <code>featbit.flag_evaluations</code>; metric events land in{" "}
            <code>featbit.metric_events</code>. Both tables are queried by
            stats-service when you analyze a run.
          </CardDescription>
        </CardHeader>
      </Card>
    </div>
  );
}
