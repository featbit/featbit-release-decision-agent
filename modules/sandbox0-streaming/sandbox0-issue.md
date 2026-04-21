**Title:** Session creation fails with GCS 429 on `manifests/latest.json` when agent has a multi-file custom skill

---

## Summary

`POST /v1/sessions` returns HTTP 500 whenever the attached agent includes a custom skill that contains multiple files. The underlying cause is a GCS `rateLimitExceeded` error on the sandbox volume's `s0fs/manifests/latest.json` object, which looks like write amplification inside skill materialization — the same manifest object is being PUT multiple times in a single session bootstrap (once per skill file), exceeding GCS's ~1 write/sec per-object mutation limit.

Retrying does **not** help, because each retry creates a brand-new sandbox volume (different UUID) and the 429 still fires inside that single request. So it is not caused by client request rate; it's amplification within a single server-side session-init flow.

## Environment

- Endpoint: `https://agents.sandbox0.ai`
- `anthropic-version: 2023-06-01`
- `anthropic-beta: managed-agents-2026-04-01`
- Client: `@anthropic-ai/sdk` via direct REST + `@hono/node-server`
- Agent engine: `claude`

## Steps to reproduce

1. Create an agent with a custom skill that contains more than one file (e.g. `SKILL.md` + `references/something.md` + `README.md`).
2. Create an LLM vault (engine = `claude`) and attach it to the session.
3. Call `POST /v1/sessions` with `{ agent, environment_id, vault_ids, title }`.

## Expected behavior

Session is created with status `idle` / `running` and I can start posting `user.message` events.

## Actual behavior

`POST /v1/sessions` → HTTP 500. Response body:

```json
{
  "error": {
    "message": "materialize custom skill skill_23eb55ed4ec9d749@1776354014160708: write skill file /.claude/skills/reversible-exposure-control/references/multi-experiment-traffic.md: client edit response: sandbox0 API error (500): internal_error - put manifests/latest.json: gcs request failed: status=429 body={...\"reason\": \"rateLimitExceeded\"...}",
    "type": "api_error"
  },
  "type": "error"
}
```

The GCS error message inside is:

> The object `sandbox0-gcp-use4-sandbox0-489807-storage/sandboxvolumes/<account_uuid>/<volume_uuid>/s0fs/manifests/latest.json` exceeded the rate limit for object mutation operations (create, update, and delete).

## Evidence that it's write amplification, not client-side rate

Four consecutive retries produced four different `volume_uuid`s but the same 429, each within a single `POST /v1/sessions`:

| Request ID | Volume UUID (new each time) |
| --- | --- |
| `f155688cf0864d08191f3ceea44f6011` | `e1beea8e-5ac7-4bac-b5ac-906246d00d73` |
| `5c587f15b624047a999acf96899b7521` | `532e9de7-19c2-41dd-85bc-c53b844bc0a6` |
| `d820661e006e85695ca4c0e41c7b7e94` | `51ac5265-0c61-466f-9890-70376fd3e40e` |
| `3ccbe5d3220f1aafd81edab981cf8d1b` | `0ddc80d3-878d-484a-8175-6a045411ef1a` |

Account UUID: `285b2852-8518-4c8c-8193-d8e772a65058`

Since each session uses a fresh manifest object but still hits the 429 inside one request, the writes must be originating from multiple PUTs to the same `manifests/latest.json` inside one materialization pass.

## Suspected root cause

Skill materialization appears to do a read-modify-write of `manifests/latest.json` once per skill file. When a skill contains N files, that's N PUTs to the same object in quick succession, which GCS rejects past ~1 write/sec per object ([GCS 429 docs](https://cloud.google.com/storage/docs/gcs429)).

## Suggested fixes

1. Write all skill files first, then commit the manifest once.
2. Or shard the manifest across multiple objects.
3. Or batch / backoff internally so a single session-init flow does not exceed GCS per-object mutation limits.

## Workaround in the meantime

Collapsing multi-file custom skills into a single `SKILL.md` avoids the amplification and lets session creation succeed.
