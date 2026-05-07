# Docker Compose deployment

The compose stack ships everything in one command — web, track-service, PostgreSQL, ClickHouse. Both database schemas bootstrap themselves on first boot, so there is nothing to apply by hand.

## What ships

| Service | Image | Port | Notes |
|---|---|---|---|
| `web` | `featbit/featbit-rda-web:${VERSION}` | `3000` | Runs `prisma migrate deploy` against `DATABASE_URL` on every container start. |
| `track-service` | `featbit/featbit-rda-track-service:${VERSION}` | `5050 → 8080` | Event ingest + per-experiment metric query. |
| `postgres` | `postgres:16-alpine` | `5432` | Persistent volume `pg_data`. |
| `clickhouse` | `clickhouse/clickhouse-server:24-alpine` | `8123`, `9000` | Auto-applies `track-service/sql/schema.sql` from `/docker-entrypoint-initdb.d/` on first boot. Persistent volume `ch_data`. |

External dependency that **isn't** in the stack: a running FeatBit instance ([`github.com/featbit/featbit`](https://github.com/featbit/featbit)). Defaults to FeatBit SaaS (`https://app-api-experimentation.featbit.co`); self-hosters set `FEATBIT_API_URL` in `.env`.

---

## Quickstart

The compose file is self-contained — no `.env`, no variable substitution. Two steps:

**1. Set the cross-service signing key.** Open `modules/docker-compose.yml` and replace the `REPLACE_ME` placeholder in the `x-signing-key` anchor near the top with a long random string. Both `web` and `track-service` reference the anchor, so you only edit one place.

Generate a key:

```bash
# macOS / Linux
openssl rand -base64 48
```

```powershell
# Windows (PowerShell 7+)
[Convert]::ToBase64String([Security.Cryptography.RandomNumberGenerator]::GetBytes(48))
```

**2. Bring the stack up.**

```bash
cd modules
docker compose up -d
```

Once the stack is healthy, open <http://localhost:3000> in your browser.

> Skipping step 1 still works on `localhost`, but `track-service` falls back to "legacy mode" (Authorization header trusted as plaintext envId, no HMAC validation) and prints a warning on every boot. Don't expose a stack with `REPLACE_ME` outside `localhost`.

### Logging in

RDA delegates authentication to **FeatBit** — there is no separate user database. To log in:

1. Make sure you have a FeatBit account on either:
   - [**featbit.co**](https://featbit.co) (FeatBit SaaS — default), or
   - your **self-hosted FeatBit instance** ([`github.com/featbit/featbit`](https://github.com/featbit/featbit)). Set `FEATBIT_API_URL` in `.env` and re-`up -d` web before logging in.
2. On the login page, enter your FeatBit email + password. RDA forwards the credentials to FeatBit, gets back a JWT, and creates a session.

If FeatBit is unreachable, login fails — check the [troubleshooting](#troubleshooting) row for *Browser login redirects in a loop*.

---

## Configuration

All knobs live in `modules/docker-compose.yml`. Edit the file directly — there is no `.env` layer. The fields you'll actually touch:

| Field (in compose) | Default | What it does |
|---|---|---|
| `image:` tag on `web` and `track-service` | `0.0.4-beta` | Pin to a different release. |
| `POSTGRES_PASSWORD` / `CLICKHOUSE_PASSWORD` | `featbit_local_pw` | Passwords for the embedded databases. Change before exposing anything. (Also update the matching values in `DATABASE_URL` and `CLICKHOUSE_CONNECTION_STRING`.) |
| `x-signing-key` anchor | `REPLACE_ME` | HMAC for signed `envId`. Replace before exposing the stack outside `localhost`. |
| `SANDBOX0_API_KEY` | empty | Required for the Managed-mode chat panel; without it the chat returns 401. |
| `FEATBIT_API_URL` | SaaS | Replace with your FeatBit API URL if self-hosting FeatBit. |
| `DATABASE_URL` (`web`) | embedded | Replace to point at an external PostgreSQL. |
| `CLICKHOUSE_CONNECTION_STRING` (`track-service`) | embedded | Replace to point at an external ClickHouse. |

### Using external databases

Replace the connection string in `docker-compose.yml`, then skip the embedded service when bringing the stack up:

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

## Going to production

Compose is fine for a single host. For HA, autoscaling, ingress + TLS, secret projection from Key Vault, and pod disruption budgets, use the Helm chart instead — see [`charts/README.md`](../../charts/README.md).

---

## Troubleshooting

| Symptom | Likely cause |
|---|---|
| `web` container restarts repeatedly with `Prisma migrate failed` | `DATABASE_URL` user lacks `CREATE` privilege on the schema, or password has unescaped special characters (URL-encode `@` → `%40` etc.) |
| `web` boots but `/api/experiments/.../analyze` returns `503` | track-service not reachable, or external CH missing schema |
| `track-service` returns `401` on every query | `web` and `track-service` see different signing keys — make sure both `TRACK_SERVICE_SIGNING_KEY` lines reference the same `*signing-key` anchor and you `docker compose up -d` to re-roll the env. |
| `track-service` logs `legacy mode (Authorization = envId)` warning | `x-signing-key` still set to `REPLACE_ME` — auth bypassed; only safe for `localhost`. |
| Browser login redirects in a loop | `FEATBIT_API_URL` points at a FeatBit backend the **server** can't reach. Try `docker compose exec web wget -qO- "$FEATBIT_API_URL/health"` |
| Chat panel returns `401: missing authorization header` | `SANDBOX0_API_KEY` is `""` in `docker-compose.yml`. |
| `clickhouse` container doesn't apply `schema.sql` | The init scripts only run when the data dir is empty. Wipe and re-init: `docker compose down -v` then `docker compose up -d` |

For the full service map and env-var reference, see [`AGENTS.md`](../../AGENTS.md).
