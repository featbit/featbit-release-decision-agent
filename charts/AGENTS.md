# charts/AGENTS.md

Operational context for anyone (human or agent) continuing work on this chart.
Read `charts/README.md` for user-facing design/usage — this file is the memo
on what's actually been deployed, where state lives, and what's pending.

## Chart

- `charts/featbit-rda/` — single umbrella Helm chart for all RDA services.
  Today only `trackService` is wired; stats-service / web / etc. plug in as
  `<serviceName>.*` sections in `values.yaml` + `templates/<service>-*.yaml`.
- Never commits secrets. Connection strings are supplied at install time via
  `--set` (dev) or projected from Azure Key Vault (prod) — see below.
- Never provisions infra it doesn't own: no DDL, no Ingress controller, no
  ClusterIssuer, no cert-manager, no KV, no ACR. README.md lists the four
  prereqs you must satisfy before `helm install`.

## Current deployments

### Azure AKS (production path) — deployed 2026-04-21

- Cluster: `featbitsaasakswu3` in RG `featbit-saas-aks-wu3` (westus3)
- Helm release: `featbit-rda` (namespace `featbit-rda`)
- Values file: `charts/featbit-rda/examples/aks/values.aks.local.yaml` (gitignored)
- Public URL: `https://track.featbit.ai/health`

Confirmed end-to-end:
- `/health` → 200 via HTTPS, Let's Encrypt prod cert
- `/api/query/experiment` → reaches Azure ClickHouse, correct JOIN semantics

### Local Docker Desktop (smoke-test path) — deployed earlier 2026-04-21

- Context: `docker-desktop`, namespace `featbit-rda`
- Values file: `charts/featbit-rda/examples/local/values.yaml`
- Points at the SAME external Azure ClickHouse via `--set` conn string
- URL: `http://track.localtest.me/health`

If you want to tear down the local one: `helm uninstall featbit-rda -n featbit-rda`
while on the `docker-desktop` kubectl context. (Check with `kubectl config current-context` first.)

## Azure resources we created today

**Not managed by the chart.** If you recreate the cluster, you recreate these.

| Resource | Name | RG | Notes |
|---|---|---|---|
| ACR | `featbitrdawu3` | `featbit-saas-wu3` | Basic SKU, attached to AKS via `az aks update --attach-acr` |
| KV secret | `featbit-rda-clickhouse-conn` in vault `featbit-kv-wu3` | `featbit-saas-wu3` | Holds the CH connection string (value lives in `modules/.env` too) |
| RBAC | `Key Vault Secrets User` on KV scoped to AKS kubelet identity | — | Identity: `e2f6263e-0f28-404f-b6ed-6f1534c0256e` |
| Cloudflare DNS | `track.featbit.ai` A → `4.149.6.254` | Cloudflare `featbit.ai` zone | **DNS only / gray cloud** — required for Let's Encrypt HTTP-01 |

## Cluster-side resources we applied (outside the chart)

- Namespace `featbit-rda`
- `SecretProviderClass/featbit-rda-secrets-kv` — single SPC projecting all
  umbrella-scoped Key Vault secrets into K8s Secrets:
  | KV secret | K8s Secret | key |
  |---|---|---|
  | `featbit-rda-clickhouse-conn` | `featbit-rda-clickhouse-secret` | `connection-string` |
  | `featbit-rda-signing-key` | `featbit-rda-signing-key-secret` | `signing-key` |
  | `featbit-rda-web-database-url` | `featbit-rda-web-database-secret` | `database-url` |
  | `featbit-rda-sandbox0-api-key` | `featbit-rda-sandbox0-secret` | `api-key` |

  Manifest template: `charts/featbit-rda/examples/aks/keyvault-secret-provider.yaml`.
  The applied one (`keyvault-secret-provider.local.yaml`, gitignored) has real
  identity / tenant / vault names filled in. To add a new secret you must
  update BOTH the public template and the local file, then re-apply.

## Pre-existing cluster infra (do NOT assume we own these)

Installed ~99 days before this work, used by multiple releases:

- NGINX Ingress Controller in `ingress-nginx` ns (3 replicas). LB IP = `4.149.6.254`.
  IngressClass name: `nginx`. **Don't re-`helm install`** it.
- cert-manager in `cert-manager` ns
- ClusterIssuers `letsencrypt-prod` and `letsencrypt-staging`
- Azure Key Vault CSI addon on AKS (secret rotation currently OFF — see TODO)

## Security checklist

- No CH credentials in any committed file. Chart templates contain placeholder
  `Password=...` strings in example comments only.
- `values.aks.local.yaml` is gitignored (via `*.local.yaml` in `.gitignore`).
  Even so it doesn't contain secrets — it references `existingSecret`.
- CH password path: `modules/.env` → human pastes into `az keyvault secret set`
  → KV → CSI → K8s Secret → pod env var. Never touches the chart.

## Build + push images by hand

CI publishes canonical images via `.github/workflows/release.yml` (see
`RELEASING.md`). The published web image has no build-time config —
`FEATBIT_API_URL`, `SANDBOX0_API_KEY`, etc. are all runtime envs set in the
chart (`web.featbit.apiUrl`, `web.extraEnv`).

If you need to push to a private ACR by hand:

```bash
docker build -t <acr>/featbit/featbit-rda-track-service:<version> modules/track-service
docker push  <acr>/featbit/featbit-rda-track-service:<version>

docker build -t <acr>/featbit/featbit-rda-web:<version> modules/web
docker push  <acr>/featbit/featbit-rda-web:<version>
```

## Chat panel modes (web)

The chat panel exposes two modes chosen per-browser at runtime:

- **Managed** (default) — web's `/api/sandbox0/*` routes proxy to sandbox0
  Managed Agents. Configure via `SANDBOX0_API_KEY` / `SANDBOX0_BASE_URL`
  (defaults to `https://agents.sandbox0.ai`). The API key in production
  comes from KV via the same SPC as the other secrets:
  - KV secret name: `featbit-rda-sandbox0-api-key`
  - Projected K8s Secret: `featbit-rda-sandbox0-secret` (key `api-key`)
  - `values.aks.local.yaml` → `web.extraEnv[SANDBOX0_API_KEY]` references
    it via `secretKeyRef`. Without this block, chat returns 401
    "missing authorization header".
- **Local Claude Code** — browser calls `http://127.0.0.1:3100`, fronted by
  the user's local `@featbit/experimentation-claude-code-connector`. No
  cluster-side config needed.

## TODO

- [ ] **Enable KV Secret rotation** on the AKS CSI addon (currently disabled;
  see `addonProfiles.azureKeyvaultSecretsProvider.config.enableSecretRotation: "false"`
  in `az aks show`). Command to flip it on:
  ```
  az aks addon update \
    --resource-group featbit-saas-aks-wu3 \
    --name featbitsaasakswu3 \
    --addon azure-keyvault-secrets-provider \
    --enable-secret-rotation
  ```
  Effect: when the CH secret is updated in KV, the projected K8s Secret
  refreshes automatically (default poll interval 2 min — already set to 2m on
  the cluster). **Caveat:** pods consuming the Secret as an env var do NOT
  auto-reload — track-service reads `CLICKHOUSE_CONNECTION_STRING` once at
  startup. So rotation helps for fresh pods (new deployments, scale-up,
  restarts) but not for updating a password without a rolling restart. If
  you want rotation without touching pods, switch to reading the secret via
  a mounted file and watching it — larger refactor, not worth it today.

- [ ] **Pin the NGINX Ingress public IP as Static** (optional hardening).
  Currently `4.149.6.254` is Dynamic but stable; `az network public-ip update
  --allocation-method Static` on resource `kubernetes-a00a61132dea843d5a0c4fcfb057f614`
  in RG `MC_featbit-saas-aks-wu3_featbitsaasakswu3_westus3` makes it survive
  a Service delete/recreate. Not urgent.

- [ ] **Retire the CH password in `modules/.env`** — the long-term path is
  KV → CSI only, with devs reading the conn string from KV when they need it
  (`az keyvault secret show --vault-name featbit-kv-wu3 --name featbit-rda-clickhouse-conn`).
  Remove the plaintext from `modules/.env` once the docker-compose flow also
  points at KV (or gets its own injection path).

- [ ] **Add more services to the chart** (stats-service, etc.) following the
  pattern in `charts/README.md` § "Adding a new service". For new services
  that also need the CH, they reuse `featbit-rda-clickhouse-secret` — that's
  why the secret is named `featbit-rda-*` (umbrella scope), not `track-service-*`.
