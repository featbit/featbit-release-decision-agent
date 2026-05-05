# Docker Compose deployment

The compose stack ships **everything in one command** — web, track-service, PostgreSQL, ClickHouse — and bootstraps the schemas on first boot. Self-hosters who already run their own PG / ClickHouse can override the connection strings to skip the embedded ones.

## What ships in this stack

| Service | Image | Port | Role |
|---|---|---|---|
| `web` | `featbit/featbit-rda-web:${VERSION}` | `3000` | Next.js dashboard + REST API + analysis engine. **Runs `prisma migrate deploy` on every container start** via its entrypoint. |
| `track-service` | `featbit/featbit-rda-track-service:${VERSION}` | `5050 → 8080` | Event ingest + per-experiment metric query. |
| `postgres` | `postgres:16-alpine` | `5432` | Embedded PG. Persisted in the `pg_data` Docker volume. |
| `clickhouse` | `clickhouse/clickhouse-server:24-alpine` | `8123` (HTTP), `9000` (native) | Embedded CH. **Auto-applies `track-service/sql/schema.sql`** on first boot via `/docker-entrypoint-initdb.d/`. Persisted in `ch_data`. |

External dependency that **isn't** in the stack:

- **A running FeatBit instance** (the feature-flag platform — [`github.com/featbit/featbit`](https://github.com/featbit/featbit)). Defaults to FeatBit SaaS at `https://app-api.featbit.co`; self-hosters set `FEATBIT_API_URL` in `.env`.

---

## Quickstart

```bash
cd modules
cp .env.example .env       # defaults are fine for first boot
docker compose up -d       # pulls images, brings up everything, applies schemas
open http://localhost:3000
```

That's it. On first boot:

1. `postgres` initialises with the user/db from `.env`.
2. `clickhouse` initialises and runs `schema.sql` against the `featbit` database.
3. `track-service` waits for ClickHouse to be healthy, then starts.
4. `web` waits for PostgreSQL to be healthy, **runs `prisma migrate deploy`**, then starts the Next.js server.

You'll need a FeatBit account on [featbit.co](https://featbit.co) (or your self-hosted FeatBit) to log in.

---

## Configuration scenarios

### Mode 1 — Full embedded stack (default)

What `docker compose up -d` does. Defaults in `.env.example` are picked up automatically.

`.env` essentials:

```env
VERSION=0.0.2-beta
POSTGRES_PASSWORD=change-me
CLICKHOUSE_PASSWORD=change-me
TRACK_SERVICE_SIGNING_KEY=$(openssl rand -base64 48)
SANDBOX0_API_KEY=<your sandbox0 key — required for chat>
```

### Mode 2 — External PostgreSQL

You already run PG (Azure / RDS / Supabase / Neon / self-hosted). Skip the embedded `postgres`.

```env
DATABASE_URL=postgresql://USER:URL_ENCODED_PW@HOST:5432/release_decision?sslmode=require
```

```bash
docker compose up -d web track-service clickhouse
```

(Just don't include `postgres` in the service list.) The web container still runs `prisma migrate deploy` on startup against your external PG, so the role behind `DATABASE_URL` needs `CREATE` / `ALTER` privileges. See [§ External PostgreSQL initialisation](#external-postgresql-initialisation).

### Mode 3 — External ClickHouse

You already run a CH instance. Skip the embedded `clickhouse`.

```env
CLICKHOUSE_CONNECTION_STRING=Host=HOST;Port=8123;User=USER;Password=PASS;Protocol=http;Database=featbit
```

```bash
docker compose up -d web track-service postgres
```

The schema is **not** auto-applied to external CH — apply it manually once. See [§ External ClickHouse initialisation](#external-clickhouse-initialisation).

### Mode 4 — Web only (no track-service, no ClickHouse)

You're using [Customer Managed Endpoint](https://docs.featbit.co/) data-source mode (web pulls metrics from your own warehouse over HTTPS). track-service + ClickHouse aren't in the loop.

```bash
docker compose up -d web postgres
```

If you also have an external PG: `docker compose up -d web` (with `DATABASE_URL` set).

---

## External PostgreSQL initialisation

The web container runs `prisma migrate deploy` automatically on every start, so it manages the **tables**. What it doesn't do: create the database itself or the role.

### Self-hosted PG

Connect as `postgres` (or any superuser) and:

```sql
CREATE DATABASE release_decision;
CREATE USER featbit_app WITH ENCRYPTED PASSWORD 'CHANGE_ME';
GRANT ALL PRIVILEGES ON DATABASE release_decision TO featbit_app;
\c release_decision
GRANT ALL ON SCHEMA public TO featbit_app;
```

The schema-level grant is required on PG 15+ (the default `public` schema permissions tightened in that release).

Then in `.env`:

```env
DATABASE_URL=postgresql://featbit_app:CHANGE_ME@HOST:5432/release_decision?sslmode=disable
```

### Cloud-hosted PG (Azure / RDS / Supabase / Neon …)

The provider's UI / CLI creates the admin role for you. Steps:

1. Create a database named `release_decision` (any name — match it in the URL).
2. Optionally create a scoped role with table-create privileges; or reuse the admin role for simplicity.
3. Cloud providers require TLS:

   ```env
   DATABASE_URL=postgresql://USER:URL_ENCODED_PW@HOST:5432/release_decision?sslmode=require
   ```

   URL-encode special characters in the password (`@` → `%40`, `:` → `%3A`, etc.) — Prisma rejects unencoded reserved chars.

4. *(Optional)* For PG behind pgbouncer / serverless pooling: append `?connection_limit=5` to avoid pool exhaustion.

### Verify the URL works before bringing the stack up

```bash
docker run --rm postgres:16 psql "$DATABASE_URL" -c "select 1"
```

---

## External ClickHouse initialisation

*(Skip this section if you're running with the embedded `clickhouse` service — it auto-applies the schema on first boot.)*

[`modules/track-service/sql/schema.sql`](../../modules/track-service/sql/schema.sql) is **idempotent** (uses `CREATE … IF NOT EXISTS`). It creates:

- The `featbit` database
- `featbit.flag_evaluations` (per-evaluation rows)
- `featbit.metric_events` (per-event rows)

Both tables ship with `MergeTree`, monthly partitioning, and a 365-day TTL — adjust the TTL clauses inside `schema.sql` if you need different retention.

### Apply the schema

Pick whichever client your CH gives you:

```bash
# Native TCP (port 9000)
clickhouse-client \
  --host HOST --port 9000 \
  --user USER --password PASSWORD \
  --queries-file modules/track-service/sql/schema.sql

# Or HTTP (port 8123) — works with managed CH (Aiven, ClickHouse Cloud, …)
curl --data-binary @modules/track-service/sql/schema.sql \
  "https://USER:PASSWORD@HOST:8123/"
```

### Custom database / table names

The schema hardcodes `featbit` as the database and `flag_evaluations` / `metric_events` as the tables. Edit the SQL **before** applying if you need different names, then override in `.env`:

```env
CLICKHOUSE_DATABASE=my_warehouse
CLICKHOUSE_FLAG_EVALUATIONS_TABLE=fb_flag_evaluations
CLICKHOUSE_METRIC_EVENTS_TABLE=fb_metric_events
```

### Verify

```bash
curl "http://USER:PASSWORD@HOST:8123/?query=SELECT+count()+FROM+featbit.flag_evaluations"
# → 0   (a 200 with a number means success)
```

---

## Pointing web at a self-hosted FeatBit

`FEATBIT_API_URL` is a server-only runtime env var. The browser never sees it directly — all FeatBit calls go through the same-origin `/api/featbit-proxy` route inside web.

```env
FEATBIT_API_URL=https://your-featbit-api.example.com
```

```bash
docker compose up -d --force-recreate web
```

No image rebuild required — the published image works against any FeatBit backend.

---

## Common operations

```bash
# Tail logs
docker compose logs -f web
docker compose logs -f track-service

# Pin a specific image version
VERSION=0.0.2-beta docker compose up -d

# Rolling restart after .env changes
docker compose up -d --force-recreate web

# Stop everything; data persists in the pg_data / ch_data volumes
docker compose down

# Stop everything AND delete volumes (full reset — schemas re-init on next up)
docker compose down -v
```

---

## Local debug overlay

`docker-compose.local.yml` builds web + track-service from source instead of pulling the published images, and adds the `run-active-test` synthetic event generator. Use it when you're developing locally and want source changes to round-trip.

```bash
cd modules
docker compose -f docker-compose.yml -f docker-compose.local.yml up -d --build
```

---

## Going to production

Compose is fine for a single host. For HA, autoscaling, ingress + TLS, secret projection from Key Vault, and pod disruption budgets, use the Helm chart instead — see [`helm.md`](helm.md).

---

## Troubleshooting

| Symptom | Likely cause |
|---|---|
| `web` container restarts repeatedly with `Prisma migrate failed` | `DATABASE_URL` user lacks `CREATE` privilege on the schema, or password has unescaped special characters |
| `web` boots but `/api/experiments/.../analyze` returns `503` | track-service not reachable, or ClickHouse schema not applied |
| `track-service` returns `401` on every query | `TRACK_SERVICE_SIGNING_KEY` mismatched between `web` and `track-service` |
| `track-service` logs `legacy mode (Authorization = envId)` warning | `TRACK_SERVICE_SIGNING_KEY` not set — auth bypassed; only safe for local dev |
| Browser login redirects in a loop | `FEATBIT_API_URL` points at a FeatBit backend the **server** can't reach (DNS, network, TLS). Verify with `docker compose exec web wget -qO- "$FEATBIT_API_URL/health"` or set it to the SaaS default and retry |
| Chat panel returns `401: missing authorization header` | `SANDBOX0_API_KEY` empty in `.env` |
| ClickHouse query errors mention missing tables | First-boot init didn't run (try `docker compose down -v` to wipe and re-init), or `CLICKHOUSE_DATABASE` / table-name overrides don't match what's in CH |
| `clickhouse` container doesn't apply `schema.sql` | The init scripts only run when the data dir is empty. Wipe and re-init: `docker compose down -v` then `docker compose up -d` |

For the full service map, env-var reference, and metric-storage contract, see [`AGENTS.md`](../../AGENTS.md).
