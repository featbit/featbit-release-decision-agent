# Docker Compose deployment

Bring up the FeatBit Release Decision Agent on a single host with Docker Compose. The default mode pulls the published images from Docker Hub — no local build required.

## What ships in this stack

| Service | Image (default mode) | Port | Role |
|---|---|---|---|
| `web` | `featbit/featbit-rda-web:${VERSION}` | `3000` | Next.js dashboard + REST API + in-process Bayesian / bandit analysis engine |
| `track-service` | `featbit/featbit-rda-track-service:${VERSION}` | `5050 → 8080` | Event ingest (`/api/track`) + per-experiment metric query (`/api/query/experiment`) |

**Always external** (the compose stack does **not** provision them):

- **PostgreSQL** — every mode needs it (web's primary store)
- **ClickHouse** — only when `track-service` is in the loop. Skip it entirely in [Customer Managed Endpoint](https://docs.featbit.co/...) mode.

For local-build / debug workflows, see [§ Local debug overlay](#local-debug-overlay) at the bottom.

---

## Prerequisites

- Docker Engine 24+ with Compose v2
- A reachable PostgreSQL 14+ (Azure Database for PostgreSQL, Supabase, RDS, self-hosted, …)
- *(Modes 2 + 4)* a reachable ClickHouse with the schema pre-applied:

  ```bash
  clickhouse-client \
    --host <host> --port 9000 \
    --user <user> --password <password> \
    --queries-file modules/track-service/sql/schema.sql
  ```

  ClickHouse DDL is **not** auto-applied — run it once before the first `docker compose up`.

PostgreSQL DDL **is** auto-applied: the web container runs `prisma migrate deploy` on first boot.

---

## Configuration scenarios

The four common shapes. All four assume you run from the `modules/` directory and have a `.env` file alongside `docker-compose.yml` (the compose file picks it up automatically).

### Mode 1 — Web only

**Use it when**: you've configured the [Customer Managed Endpoint](https://docs.featbit.co/...) data source mode (web pulls metrics from your own data warehouse) **OR** you point web at a separately-hosted track-service that's not part of this compose.

**`.env`**

```env
# Required
DATABASE_URL=postgresql://USER:PASSWORD@HOST:5432/release_decision

# Required when web should hit an external track-service. Skip if all your
# experiments use Customer Managed Endpoint mode (no track-service at all).
TRACK_SERVICE_URL=https://track.featbit.ai
TRACK_SERVICE_SIGNING_KEY=<must match the external track-service's key>

# Required for the Managed-mode chat panel (sandbox0).
SANDBOX0_API_KEY=<your sandbox0 api key>
```

**Run**

```bash
cd modules
docker compose pull web
docker compose up -d web
```

Open http://localhost:3000.

> **Note**: omitting `TRACK_SERVICE_URL` makes web default to `http://track-service:8080` (the in-network hostname). If track-service isn't running, analyses that try the FeatBit-managed pipeline will get DNS errors. That's why this mode requires you to set it explicitly.

---

### Mode 2 — Web + track-service (default, full self-hosted stack)

**Use it when**: you want the canonical FeatBit experimentation pipeline — events flow into your ClickHouse via track-service, web reads metrics back via track-service.

**`.env`**

```env
# Required by web
DATABASE_URL=postgresql://USER:PASSWORD@HOST:5432/release_decision
SANDBOX0_API_KEY=<your sandbox0 api key>

# Required by track-service
CLICKHOUSE_CONNECTION_STRING=Host=HOST;Port=9000;User=USER;Password=PASSWORD;Database=featbit

# Shared HMAC key — identical on every service that mints or validates env-secrets.
# Generate once: `openssl rand -base64 48`
TRACK_SERVICE_SIGNING_KEY=<long-random-string>
```

**Run**

```bash
cd modules
docker compose pull
docker compose up -d
```

Web's `TRACK_SERVICE_URL` defaults to `http://track-service:8080` (the in-network hostname), so the two services find each other automatically.

---

### Mode 3 — External PostgreSQL (always)

PostgreSQL is **always** external in this stack — there is no `postgres` service in the compose file. Every mode needs `DATABASE_URL` set in `.env`.

**Format**

```env
DATABASE_URL=postgresql://USER:PASSWORD@HOST:5432/DBNAME?sslmode=require
```

**Notes**

- URL-encode special characters in the password (`@` → `%40`, `:` → `%3A`, etc.). Prisma rejects unencoded reserved characters.
- `sslmode=require` is mandatory for cloud-hosted PG (Azure / RDS / Supabase / Neon). Self-hosted PG without TLS works with `sslmode=disable`, but only do this on a private network.
- The `web` service runs `prisma migrate deploy` on every start. The role identified by `DATABASE_URL` therefore needs `CREATE` / `ALTER` privileges on the target schema.
- Connection pooling: web uses Prisma's default pool. For PG behind a serverless / pgbouncer layer, append `?connection_limit=5` to the URL to avoid pool exhaustion.

**Verify the URL works before bringing the stack up**

```bash
docker run --rm -e DATABASE_URL="$DATABASE_URL" postgres:16 \
  psql "$DATABASE_URL" -c "select 1"
```

---

### Mode 4 — External ClickHouse (when track-service is enabled)

ClickHouse is required only when `track-service` is in the loop (i.e. Mode 2). It is **always** external — no `clickhouse` service in compose.

**Format**

```env
CLICKHOUSE_CONNECTION_STRING=Host=HOST;Port=9000;User=USER;Password=PASSWORD;Protocol=http;Database=featbit
```

The string is parsed by the .NET ClickHouse client. Common keys: `Host`, `Port` (9000 = native TCP, 8123 = HTTP), `User`, `Password`, `Protocol` (`http` / `tcp`), `Database`, `Compression`.

**Apply the schema before first run** (idempotent — safe to re-run):

```bash
clickhouse-client \
  --host HOST --port 9000 \
  --user USER --password PASSWORD \
  --queries-file modules/track-service/sql/schema.sql
```

This creates `flag_evaluations` and `metric_events` tables in the `featbit` database. If your CH database has a different name, override at runtime via env vars in `.env`:

```env
CLICKHOUSE_DATABASE=my_warehouse
CLICKHOUSE_FLAG_EVALUATIONS_TABLE=fb_flag_evaluations
CLICKHOUSE_METRIC_EVENTS_TABLE=fb_metric_events
```

These map to the .NET `ClickHouse:Database` / `ClickHouse:FlagEvaluationsTable` / `ClickHouse:MetricEventsTable` config keys consumed by track-service.

**Verify the connection works** (HTTP):

```bash
curl "http://USER:PASSWORD@HOST:8123/?query=SELECT%201"
```

---

## Common operations

```bash
# Tail logs
docker compose logs -f web
docker compose logs -f track-service

# Pin a specific image version (otherwise picks up whatever default is in docker-compose.yml)
VERSION=0.0.2-beta docker compose up -d

# Rolling restart after .env changes
docker compose up -d --force-recreate web

# Stop everything (DBs are external — they're untouched)
docker compose down
```

---

## Local debug overlay

`docker-compose.local.yml` is the debug overlay that **builds images from source** and adds the `run-active-test` synthetic event generator. Use it when you're developing locally and want source changes to round-trip.

```bash
cd modules
docker compose -f docker-compose.yml -f docker-compose.local.yml up -d --build
```

What the overlay changes vs the default:

- `track-service` and `web` build from `./track-service` / `./web` instead of pulling from Docker Hub.
- `track-service`'s `ASPNETCORE_ENVIRONMENT` flips back to `Development`.
- `run-active-test` (Cloudflare Worker that emits synthetic events) joins the stack — there is no published image for it.

---

## Going to production

Compose is fine for a single host. For HA, autoscaling, ingress + TLS, secret projection from Key Vault, and pod disruption budgets, use the Helm chart instead — see [`helm.md`](helm.md).

---

## Troubleshooting

| Symptom | Likely cause |
|---|---|
| `web` container restarts repeatedly with `Prisma migrate failed` | `DATABASE_URL` user lacks `CREATE` privilege on the schema, or password has unescaped special characters |
| `web` boots but `/api/experiments/.../analyze` returns `503` | `track-service` not reachable, or ClickHouse schema not applied |
| `track-service` returns `401` on every query | `TRACK_SERVICE_SIGNING_KEY` mismatched between `web` and `track-service` |
| `track-service` logs `legacy mode (Authorization = envId)` warning | `TRACK_SERVICE_SIGNING_KEY` not set — auth is being bypassed; only safe for local dev |
| Browser login redirects in a loop | `NEXT_PUBLIC_FEATBIT_API_URL` (build-time, baked into the image) points somewhere the **browser** can't resolve. Self-hosters of FeatBit must rebuild the web image with the right URL — see § Local debug overlay |
| Chat panel returns `401: missing authorization header` | `SANDBOX0_API_KEY` empty in `.env` |
| ClickHouse query errors mention missing tables | Schema not applied, or `CLICKHOUSE_DATABASE` / table-name overrides don't match what's in CH |

For the full service map, env-var reference, and metric-storage contract, see [`AGENTS.md`](../../AGENTS.md).
