# featbit-rda on local Docker Desktop Kubernetes

Smoke-test the chart on Docker Desktop's built-in Kubernetes. No cloud, no ACR,
no cert-manager. Uses Docker Desktop's NGINX Ingress via `localhost`.

The chart does NOT manage ClickHouse — the target ClickHouse and its tables
(`flag_evaluations`, `metric_events`) are assumed to already exist. See
`modules/track-service/sql/schema.sql` for the reference DDL; applying it is
an operator task, not something the chart does at install time.

## Prereqs

- Docker Desktop with Kubernetes enabled (`kubectl config current-context` → `docker-desktop`)
- NGINX Ingress Controller (`kubectl get svc -n ingress-nginx` → `EXTERNAL-IP = localhost`)
- A reachable ClickHouse with the track-service tables already provisioned.
  The conn string used by the docker-compose setup lives in `modules/.env` under
  `CLICKHOUSE_CONNECTION_STRING` — you can reuse the same one.
- helm 3.x

## Steps

### 1. Build the track-service image

Docker Desktop's k8s shares the host Docker daemon, so a locally-built image is
visible to pods without pushing to a registry.

```bash
cd modules/track-service
docker build -t track-service:local .
```

### 2. Install the chart

Supply the ClickHouse connection string via `--set` so the password stays out of
the values file. Note the `database` must match the DB on your CH where the
tables live (for the Azure CH in `modules/.env`, that's `default`, not `featbit`).

```bash
kubectl create namespace featbit-rda  # first time only

helm upgrade --install featbit-rda charts/featbit-rda \
  -f charts/featbit-rda/examples/local/values.yaml \
  --set trackService.clickHouse.connectionString="$(grep '^CLICKHOUSE_CONNECTION_STRING=' modules/.env | cut -d= -f2-)" \
  --namespace featbit-rda
```

### 3. Verify

```bash
kubectl get pods -n featbit-rda
kubectl logs -n featbit-rda -l app.kubernetes.io/component=track-service --tail=30
```

Health via Ingress (`*.localtest.me` resolves to 127.0.0.1 via public DNS):
```bash
curl http://track.localtest.me/health
```

### 4. Send a test event

```bash
TS=$(date +%s)000
curl -i -X POST http://track.localtest.me/api/track \
  -H "Authorization: local-env" \
  -H "Content-Type: application/json" \
  -d "[{
    \"user\": { \"keyId\": \"u-1\", \"properties\": { \"country\": \"US\" } },
    \"variations\": [
      { \"flagKey\": \"demo\", \"variant\": \"treatment\",
        \"timestamp\": $TS, \"experimentId\": \"exp-1\" }
    ],
    \"metrics\": [
      { \"eventName\": \"clicked\", \"timestamp\": $TS }
    ]
  }]"
```

Expect `202 Accepted` with `{"accepted":2,"dropped":0}`. The batch worker flushes
every 5s; after that the rows are queryable via `POST /api/query/experiment` or
directly against the external ClickHouse.

### 5. Cleanup

```bash
helm uninstall featbit-rda -n featbit-rda
kubectl delete namespace featbit-rda
```

The external ClickHouse is untouched — the chart never writes DDL.

## Gotchas

- **`ImagePullBackOff`** — confirm `docker images | grep track-service` shows `track-service:local`.
- **`ClickHouse flush failed` in logs** — check the connection string and that the DB
  name (`trackService.clickHouse.database`) matches the DB where the tables live.
- **Ingress 404** — NGINX routes by `Host:`. `curl -H "Host: track.localtest.me" http://localhost`
  works even if DNS is flaky.
