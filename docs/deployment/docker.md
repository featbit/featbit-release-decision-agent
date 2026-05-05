# Docker Compose deployment

Bring up FeatBit Experimentation on a single host with Docker Compose. This is the fastest path to a working stack you can point your application at.

The compose file builds and starts:

| Service | Port | Role |
|---|---|---|
| `web` | `3000` | Next.js dashboard + REST API + in-process Bayesian / bandit analysis engine |
| `track-service` | `5050 → 8080` | Event ingest (`/api/track`) + per-experiment metric query (`/api/query/experiment`) |

External dependencies you provision yourself (the compose stack does **not** spin them up):

- **PostgreSQL** — holds experiments, runs, activity, memory, sessions
- **ClickHouse** *(only if you keep `track-service`)* — holds `flag_evaluations` + `metric_events`

> If you bring your own data warehouse via the **Customer Managed Endpoint** mode, you can disable / remove `track-service` and skip ClickHouse entirely.

---

## 1. Prerequisites

- Docker Engine 24+ with Compose v2
- A reachable PostgreSQL 14+ instance (Azure Database for PostgreSQL, Supabase, RDS, self-hosted, …)
- *(If using `track-service`)* a reachable ClickHouse instance with the schema applied:

  ```bash
  clickhouse-client \
    --host <host> --port 9000 \
    --user <user> --password <password> \
    --queries-file modules/track-service/sql/schema.sql
  ```

---

## 2. Configure `.env`

Create `modules/.env` next to `docker-compose.yml`:

```env
# PostgreSQL (web service)
DATABASE_URL=postgresql://USER:PASSWORD@HOST:5432/release_decision

# ClickHouse (track-service)
CLICKHOUSE_CONNECTION_STRING=Host=HOST;Port=9000;User=USER;Password=PASSWORD;Database=featbit

# Shared HMAC key — every service that mints or validates env-secrets must
# share the same value (web, track-service, any custom worker).
TRACK_SERVICE_SIGNING_KEY=<long-random-string>

# Browser-side base URL for the FeatBit backend (this is baked into the web
# bundle at build time). Use https://app-api.featbit.co for FeatBit Cloud,
# or your self-hosted FeatBit API URL.
NEXT_PUBLIC_FEATBIT_API_URL=https://app-api.featbit.co
```

---

## 3. Apply the database schema

The `web` container runs Prisma migrations on first boot — you do not need to run them manually for PostgreSQL.

ClickHouse DDL is **not** auto-applied. Run `modules/track-service/sql/schema.sql` once against your ClickHouse before the first `docker compose up`.

---

## 4. Bring it up

```bash
cd modules
docker compose up -d
```

Tail logs while the stack settles:

```bash
docker compose logs -f web
docker compose logs -f track-service
```

Open [http://localhost:3000](http://localhost:3000) and create your first experiment.

---

## 5. Common operations

```bash
# Rebuild a single service after code changes
docker compose build web && docker compose up -d web

# Rolling restart
docker compose restart web

# Stop everything
docker compose down

# Stop + delete container state (DBs are external, so they're untouched)
docker compose down -v
```

---

## 6. Going to production

Compose is fine for a single host. For HA, autoscaling, ingress + TLS, secret projection, and PDBs, use the Helm chart instead — see [`helm.md`](helm.md).

---

## Troubleshooting

| Symptom | Likely cause |
|---|---|
| `web` boots but `/api/experiments/.../analyze` returns `503` | `track-service` not reachable, or ClickHouse schema not applied |
| `track-service` returns `401` on every query | `TRACK_SERVICE_SIGNING_KEY` mismatched between `web` and `track-service` |
| Browser login redirects in a loop | `NEXT_PUBLIC_FEATBIT_API_URL` set to a value the **browser** can't resolve (it is a build-time variable) |
| ClickHouse query errors mention missing tables | `schema.sql` not applied to the database referenced in `CLICKHOUSE_CONNECTION_STRING` |

For the full service map, env-var reference, and metric-storage contract, see [`AGENTS.md`](../../AGENTS.md).
