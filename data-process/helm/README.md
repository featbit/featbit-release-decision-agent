# data-process — Helm Chart

Deploys **rollup-service** (.NET 10) and **stats-service** (Python FastAPI) as **two containers in a single pod** on Azure Kubernetes Service.

```
Pod: release-data-process
├── container: rollup-service  (port 8080)  — .NET background worker, compact R2 segments → PostgreSQL
└── container: stats-service   (port 8000)  — Python FastAPI, Bayesian analysis loop
```

---

## Prerequisites

- AKS cluster with `kubectl` configured (`kubectl get nodes` works)
- Azure Container Registry (ACR) with the cluster granted pull access
- `helm` ≥ 3.12 installed
- Target namespace exists: `kubectl create namespace featbit` (if needed)

---

## Step 1 — Build & Push Docker images

```bash
ACR=myacr.azurecr.io   # replace with your ACR login server

# rollup-service
docker build -t $ACR/data-process/rollup-service:latest ./data-process/rollup-service
docker push $ACR/data-process/rollup-service:latest

# stats-service
docker build -t $ACR/data-process/stats-service:latest ./data-process/stats-service
docker push $ACR/data-process/stats-service:latest
```

Attach ACR pull permissions to AKS (only once):
```bash
az aks update -n <aks-name> -g <resource-group> --attach-acr <acr-name>
```

---

## Step 2 — Create the Kubernetes Secret

The pod reads sensitive values from a secret named `data-process-secrets` (or set `secrets.existingSecret` in values).

```bash
kubectl create secret generic data-process-secrets \
  --namespace featbit \
  --from-literal=DATABASE_URL="postgresql://user:pass@host:5432/release_decision?sslmode=require" \
  --from-literal=R2_ACCOUNT_ID="<cloudflare-account-id>" \
  --from-literal=R2_ACCESS_KEY_ID="<r2-access-key>" \
  --from-literal=R2_SECRET_ACCESS_KEY="<r2-secret-key>" \
  --from-literal=R2_BUCKET_NAME="featbit-tsdb"
```

---

## Step 3 — Install / Upgrade via Helm

```bash
helm upgrade --install release data-process/helm \
  --namespace featbit \
  --set rollupService.image.repository=$ACR/data-process/rollup-service \
  --set statsService.image.repository=$ACR/data-process/stats-service \
  --set secrets.existingSecret=data-process-secrets
```

> `release` is the Helm release name — change as needed. The pod will be named `release-data-process-<hash>`.

---

## Step 4 — Verify

```bash
# Check pod is Running (2/2 containers ready)
kubectl get pods -n featbit -l app=release-data-process

# Tail logs from each container
kubectl logs -n featbit -l app=release-data-process -c rollup-service --follow
kubectl logs -n featbit -l app=release-data-process -c stats-service  --follow

# Health checks (from within the cluster)
kubectl run -it --rm curl --image=curlimages/curl --restart=Never -- \
  curl http://release-data-process.featbit:8080/health
kubectl run -it --rm curl --image=curlimages/curl --restart=Never -- \
  curl http://release-data-process.featbit:8000/health
```

---

## Configuration Reference

| `values.yaml` key | Default | Description |
|---|---|---|
| `replicaCount` | `1` | Fixed at 1; both workers are single-instance by design |
| `rollupService.image.repository` | `""` | ACR image path |
| `rollupService.worker.intervalSeconds` | `600` | Rollup cycle interval |
| `rollupService.worker.maxConcurrency` | `4` | Parallel R2 compactions |
| `statsService.image.repository` | `""` | ACR image path |
| `statsService.analysisIntervalSeconds` | `600` | Analysis loop interval |
| `secrets.existingSecret` | `""` | Name of pre-created K8s secret |
| `namespace` | `featbit` | Target namespace |

---

## Uninstall

```bash
helm uninstall release --namespace featbit
kubectl delete secret data-process-secrets --namespace featbit
```
