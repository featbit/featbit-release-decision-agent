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
- **A running FeatBit instance** — RDA's web app delegates all auth and flag evaluation to FeatBit. SaaS users get this for free at [featbit.co](https://featbit.co); self-hosters install [`github.com/featbit/featbit`](https://github.com/featbit/featbit) first and then set `FEATBIT_API_URL` in `modules/.env` to point web at their own backend (runtime env, no rebuild required).
- A reachable PostgreSQL 14+ (Azure Database for PostgreSQL, Supabase, RDS, self-hosted, …)
- *(Modes 2 + 4)* a reachable ClickHouse instance

---

## Initialize PostgreSQL

Web's container runs `prisma migrate deploy` automatically on every start, so it creates / migrates the **tables** for you. What it does **not** do: create the database itself or the role used to connect. You do that once.

### Self-hosted PostgreSQL

Connect as a PG superuser (typically `postgres`) and run:

```sql
CREATE DATABASE release_decision;
CREATE USER featbit_app WITH ENCRYPTED PASSWORD 'CHANGE_ME';
GRANT ALL PRIVILEGES ON DATABASE release_decision TO featbit_app;
\c release_decision
GRANT ALL ON SCHEMA public TO featbit_app;
```

The schema-level grant is required on PG 15+ — the default `public` schema permissions tightened in that release, and Prisma needs to `CREATE TABLE` there.

Then in `modules/.env`:

```env
DATABASE_URL=postgresql://featbit_app:CHANGE_ME@HOST:5432/release_decision?sslmode=disable
```

### Cloud-hosted PostgreSQL (Azure / RDS / Supabase / Neon …)

You already have an admin role. Use the provider's UI / CLI to:

1. Create a database named `release_decision` (or any name — match it in the URL below).
2. Optionally create a scoped role with table-create privileges; or just reuse the admin role for simplicity.
3. Copy the connection string into `modules/.env`. Cloud providers require TLS:

   ```env
   DATABASE_URL=postgresql://USER:URL_ENCODED_PASSWORD@HOST:5432/release_decision?sslmode=require
   ```

   URL-encode special characters in the password (`@` → `%40`, `:` → `%3A`, etc.) — Prisma rejects unencoded reserved chars.

4. *(Optional)* If your PG sits behind pgbouncer / a serverless pool, append `?connection_limit=5` to the URL to avoid exhausting the upstream pool.

### Verify before bringing the stack up

```bash
docker run --rm -e URL="$DATABASE_URL" postgres:16 psql "$URL" -c "select 1"
```

---

## Initialize ClickHouse

*(Skip this section if you're running Mode 1 with Customer Managed Endpoints — track-service isn't in the loop.)*

The schema file [`modules/track-service/sql/schema.sql`](../../modules/track-service/sql/schema.sql) is **idempotent** (uses `CREATE … IF NOT EXISTS`). It creates the database **and** the two tables track-service writes to:

- `featbit.flag_evaluations` — per-evaluation rows (env, flag, user, variant, timestamp)
- `featbit.metric_events`    — per-event rows (env, event, user, value, timestamp)

Both tables ship with `MergeTree`, monthly partitioning, and a 365-day TTL — adjust the TTL clauses inside the schema file if you need a different retention.

### Apply the schema

Pick whichever client your CH cluster gives you:

```bash
# clickhouse-client (native TCP, port 9000)
clickhouse-client \
  --host HOST --port 9000 \
  --user USER --password PASSWORD \
  --queries-file modules/track-service/sql/schema.sql

# Or HTTP (port 8123) — works with managed CH (Aiven, ClickHouse Cloud, …)
curl --data-binary @modules/track-service/sql/schema.sql \
  "https://USER:PASSWORD@HOST:8123/"
```

### Custom database / table names

The schema file hardcodes `featbit` as the database and `flag_evaluations` / `metric_events` as the table names. If you need different names (because your CH already has a `featbit` database in use, etc.), edit the SQL **before** applying it, then override the matching env vars in `modules/.env`:

```env
CLICKHOUSE_DATABASE=my_warehouse
CLICKHOUSE_FLAG_EVALUATIONS_TABLE=fb_flag_evaluations
CLICKHOUSE_METRIC_EVENTS_TABLE=fb_metric_events
```

These map to the .NET `ClickHouse:Database` / `ClickHouse:FlagEvaluationsTable` / `ClickHouse:MetricEventsTable` config keys consumed by track-service.

### Verify

```bash
curl "http://USER:PASSWORD@HOST:8123/?query=SELECT+count()+FROM+featbit.flag_evaluations"
# → 0   (or whatever count you have; an HTTP 200 with a number means success)
```

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

> **PostgreSQL** and **ClickHouse** are always external — see [§ Initialize PostgreSQL](#initialize-postgresql) and [§ Initialize ClickHouse](#initialize-clickhouse) above for setup. The compose stack never spins them up itself.

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

## Pointing web at a self-hosted FeatBit

`FEATBIT_API_URL` is a server-only runtime env var (defaults to `https://app-api.featbit.co`). The browser never sees it directly — all FeatBit calls go through the same-origin `/api/featbit-proxy` route inside web. So you can point at any FeatBit backend just by setting the env var:

```env
# modules/.env
FEATBIT_API_URL=https://your-featbit-api.example.com
```

```bash
cd modules
docker compose up -d --force-recreate web
```

No image rebuild required — the published `featbit/featbit-rda-web` image works against any FeatBit backend.

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
| Browser login redirects in a loop | `FEATBIT_API_URL` points at a FeatBit backend the **server** can't reach (DNS, network, TLS). Verify with `docker compose exec web wget -qO- "$FEATBIT_API_URL/health"` or set it to the SaaS default and retry. |
| Chat panel returns `401: missing authorization header` | `SANDBOX0_API_KEY` empty in `.env` |
| ClickHouse query errors mention missing tables | Schema not applied, or `CLICKHOUSE_DATABASE` / table-name overrides don't match what's in CH |

For the full service map, env-var reference, and metric-storage contract, see [`AGENTS.md`](../../AGENTS.md).
