# featbit-rda on Azure AKS

Deploy the FeatBit Release Decision Agent services to AKS behind NGINX Ingress,
with images pulled from Azure Container Registry and (optionally) secrets sourced
from Azure Key Vault.

Only `track-service` is wired up today; other services are added by extending
the top-level chart's `values.yaml`.

## ⚠️ Required before `helm install`

The chart itself does **not** provision any of the following — you apply them
to the cluster *before* installing the chart. This is the price of keeping
the chart cloud-neutral.

| # | What | Why it's separate from the chart |
|---|------|----------------------------------|
| 1 | ClickHouse tables | The chart never runs DDL. See `modules/track-service/sql/schema.sql`. |
| 2 | **`SecretProviderClass`** (`keyvault-secret-provider.yaml`) | Projects the CH connection string from Azure Key Vault into a K8s Secret. Azure-specific; lives outside the chart so the chart stays portable. The chart *reads* the Secret via `trackService.clickHouse.existingSecret`. |
| 3 | NGINX Ingress Controller + ClusterIssuer | Cluster-wide infra, shared by all services. |
| 4 | ACR attached to AKS | `az aks update --attach-acr`. |

**Skip step 2 and the pod's CSI volume mount will stall at
`MountVolume.SetUp failed: ... secret not found`.** That is the single most
common install failure on AKS — it is not a chart bug.

## Architecture

```
Internet
   │
   ▼
Azure LoadBalancer (public IP)
   │
   ▼
NGINX Ingress Controller  ◄── cert-manager issues Let's Encrypt TLS certs
   │
   ▼
ClusterIP Services
   │
   ▼
track-service pods  ──►  Azure ClickHouse (conn string from K8s Secret or Key Vault)
```

One LB IP. Ingress rules by `Host:` header route:

- `track.example.com` → `track-service` Service

Future services register their own Ingress rule (same controller, same LB IP).

## Files

- `values.yaml` — example Helm values; copy to `values.local.yaml` and customize
- `keyvault-secret-provider.yaml` — optional, pulls ClickHouse conn string from Azure Key Vault
- `cluster-issuer.yaml` — Let's Encrypt ClusterIssuers (skip if already installed)

`*.local.yaml` is gitignored.

## Prerequisites

```bash
# CLI tools
az aks install-cli
helm repo add ingress-nginx https://kubernetes.github.io/ingress-nginx
helm repo add jetstack https://charts.jetstack.io
helm repo update

# Connect to cluster
az aks get-credentials --resource-group <rg> --name <cluster>
```

## One-time cluster setup

### 1. Attach ACR to AKS

```bash
az aks update --name <cluster> --resource-group <rg> --attach-acr <acr>
```

The kubelet managed identity gets `AcrPull`, so no `imagePullSecrets` needed.

### 2. Build and push the track-service image

```bash
cd modules/track-service
az acr login --name <acr>
docker build -t <acr>.azurecr.io/featbit/track-service:0.1.0 .
docker push <acr>.azurecr.io/featbit/track-service:0.1.0
```

### 3. Install NGINX Ingress Controller

```bash
helm install ingress-nginx ingress-nginx/ingress-nginx \
  --namespace ingress-nginx --create-namespace \
  --set controller.replicaCount=3 \
  --set controller.service.externalTrafficPolicy=Local
```

Get the public IP:
```bash
kubectl get svc -n ingress-nginx ingress-nginx-controller
```

### 4. Install cert-manager and ClusterIssuers

```bash
helm install cert-manager jetstack/cert-manager \
  --namespace cert-manager --create-namespace \
  --set crds.enabled=true --version v1.16.2

cp cluster-issuer.yaml cluster-issuer.local.yaml
# edit email, then:
kubectl apply -f cluster-issuer.local.yaml
```

### 5. (Optional) Key Vault CSI driver

Skip this section if you are putting the ClickHouse connection string directly
in `values.local.yaml` for dev / staging.

```bash
az aks enable-addons --addons azure-keyvault-secrets-provider \
  --name <cluster> --resource-group <rg>

IDENTITY_CLIENT_ID=$(az aks show -g <rg> -n <cluster> \
  --query identityProfile.kubeletidentity.clientId -o tsv)

az role assignment create \
  --role "Key Vault Secrets User" \
  --assignee $IDENTITY_CLIENT_ID \
  --scope /subscriptions/<sub>/resourceGroups/<rg>/providers/Microsoft.KeyVault/vaults/<kv>

az keyvault secret set --vault-name <kv> \
  --name track-service-clickhouse-conn \
  --value "Host=...;Port=8443;Username=default;Password=...;Protocol=https;Database=featbit"

kubectl create namespace featbit-rda

cp keyvault-secret-provider.yaml keyvault-secret-provider.local.yaml
# edit tenantId, userAssignedIdentityID, keyvaultName
kubectl apply -f keyvault-secret-provider.local.yaml
```

Then in `values.local.yaml`, use the (B) block that points `trackService.clickHouse.existingSecret`
at `track-service-clickhouse-secret` and mounts the CSI volume.

### 6. Point DNS at the NGINX LB

```
track.example.com  A  <NGINX-IP>
```

## Install

```bash
cp values.yaml values.local.yaml
# edit: global.imageRegistry, trackService.image.tag,
#       trackService.clickHouse.*, trackService.ingress.host

helm install featbit-rda ../../ \
  -f values.local.yaml \
  --namespace featbit-rda --create-namespace
```

## Verify

```bash
kubectl get pods -n featbit-rda
kubectl get ingress -n featbit-rda
kubectl get certificate -n featbit-rda
curl https://track.example.com/health
```

## Upgrade

```bash
# after pushing a new image tag
helm upgrade featbit-rda ../../ \
  -f values.local.yaml \
  --namespace featbit-rda \
  --set trackService.image.tag=0.2.0
```

Rolling update keeps ≥3 pods available (`maxUnavailable: 0`, HPA min 3, PDB min 2).

## Troubleshooting

Pod not starting:
```bash
kubectl describe pod -n featbit-rda -l app.kubernetes.io/component=track-service
kubectl logs -n featbit-rda -l app.kubernetes.io/component=track-service
```

Cert not issued:
```bash
kubectl describe certificate -n featbit-rda track-service-tls
kubectl logs -n cert-manager deployment/cert-manager
```

ACR pull failing (check AKS <-> ACR attachment):
```bash
az aks check-acr --name <cluster> --resource-group <rg> --acr <acr>.azurecr.io
```
