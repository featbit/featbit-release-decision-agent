# Docker Compose deployment

The compose stack ships everything in one command — web, track-service, PostgreSQL, ClickHouse. Both database schemas bootstrap themselves on first boot, so there is nothing to apply by hand.

## What ships

| Service | Image | Port | Notes |
|---|---|---|---|
| `web` | `featbit/featbit-rda-web:${VERSION}` | `3000` | Runs `prisma migrate deploy` against `DATABASE_URL` on every container start. |
| `track-service` | `featbit/featbit-rda-track-service:${VERSION}` | `5050 → 8080` | Event ingest + per-experiment metric query. |
| `postgres` | `postgres:16-alpine` | `5432` | Persistent volume `pg_data`. |
| `clickhouse` | `clickhouse/clickhouse-server:24-alpine` | `8123`, `9000` | Auto-applies `track-service/sql/schema.sql` from `/docker-entrypoint-initdb.d/` on first boot. Persistent volume `ch_data`. |

External dependency that **isn't** in the stack: a running FeatBit instance ([`github.com/featbit/featbit`](https://github.com/featbit/featbit)). Defaults to FeatBit SaaS (`https://app-api.featbit.co`); self-hosters set `FEATBIT_API_URL` in `.env`.

---

## Quickstart

```bash
cd modules
cp .env.example .env       # defaults are fine for first boot
docker compose up -d
open http://localhost:3000
```

Log in with your FeatBit account ([featbit.co](https://featbit.co) or your self-hosted FeatBit).

---

## Configuration

Edit `modules/.env`. The knobs you'll actually touch:

| Variable | Default | What it does |
|---|---|---|
| `VERSION` | `0.0.2-beta` | Image tag for `web` and `track-service`. |
| `POSTGRES_PASSWORD` / `CLICKHOUSE_PASSWORD` | `featbit_local_pw` | Passwords for the embedded databases. Change before exposing anything. |
| `TRACK_SERVICE_SIGNING_KEY` | empty | HMAC for signed `envId`. Set to a long random string; the same value must be on both web and track-service. Generate: `openssl rand -base64 48`. |
| `SANDBOX0_API_KEY` | empty | Required for the Managed-mode chat panel; without it the chat returns 401. |
| `FEATBIT_API_URL` | SaaS | Set to your FeatBit API URL if self-hosting FeatBit. |
| `DATABASE_URL` | embedded | Override to point at an external PostgreSQL. |
| `CLICKHOUSE_CONNECTION_STRING` | embedded | Override to point at an external ClickHouse. |

### Using external databases

Override the connection string in `.env`, then skip the embedded service when bringing the stack up:

```bash
# External PG + external CH:
docker compose up -d web track-service

# External PG only:
docker compose up -d web track-service clickhouse

# External CH only:
docker compose up -d web track-service postgres
```

Two things to know:

- **External PG**: the role in `DATABASE_URL` needs `CREATE` / `ALTER` privileges (web runs `prisma migrate deploy` on every start).
- **External CH**: apply the schema once before first run — `clickhouse-client --queries-file modules/track-service/sql/schema.sql` (idempotent).

### Web only (no track-service / ClickHouse)

You're using [Customer Managed Endpoint](https://docs.featbit.co/) data-source mode — track-service isn't in the loop:

```bash
docker compose up -d web postgres
```

---

## Common operations

```bash
# Tail logs
docker compose logs -f web
docker compose logs -f track-service

# Pin a different image version
VERSION=0.0.3-beta docker compose up -d

# Apply .env changes
docker compose up -d --force-recreate web

# Stop everything; data persists in pg_data / ch_data volumes
docker compose down

# Full reset — wipes the embedded databases too, schemas re-init on next up
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
| `web` container restarts repeatedly with `Prisma migrate failed` | `DATABASE_URL` user lacks `CREATE` privilege on the schema, or password has unescaped special characters (URL-encode `@` → `%40` etc.) |
| `web` boots but `/api/experiments/.../analyze` returns `503` | track-service not reachable, or external CH missing schema |
| `track-service` returns `401` on every query | `TRACK_SERVICE_SIGNING_KEY` mismatched between web and track-service |
| `track-service` logs `legacy mode (Authorization = envId)` warning | `TRACK_SERVICE_SIGNING_KEY` not set — auth bypassed; only safe for local dev |
| Browser login redirects in a loop | `FEATBIT_API_URL` points at a FeatBit backend the **server** can't reach. Try `docker compose exec web wget -qO- "$FEATBIT_API_URL/health"` |
| Chat panel returns `401: missing authorization header` | `SANDBOX0_API_KEY` empty in `.env` |
| `clickhouse` container doesn't apply `schema.sql` | The init scripts only run when the data dir is empty. Wipe and re-init: `docker compose down -v` then `docker compose up -d` |

For the full service map and env-var reference, see [`AGENTS.md`](../../AGENTS.md).
