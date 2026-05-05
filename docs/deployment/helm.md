# Helm chart deployment

Production-grade install on Kubernetes. The umbrella chart at [`charts/featbit-rda/`](../../charts/featbit-rda/) ships per-service `Deployment`, `Service`, `Ingress`, `HPA`, `PDB`, `ServiceAccount`, and `Secret` templates.

The chart is deliberately cloud-neutral — it does **not** provision PostgreSQL or ClickHouse, and it does **not** apply any DDL.

---

## 1. Prerequisites

Provision before `helm install`, or pods will fail to start:

1. **PostgreSQL database** reachable from the cluster.
2. **ClickHouse database + tables** *(only if you keep `track-service`)* — apply [`modules/track-service/sql/schema.sql`](../../modules/track-service/sql/schema.sql).
3. **A Kubernetes Secret holding the ClickHouse connection string**, referenced by `trackService.clickHouse.existingSecret`. On AKS this is typically projected from Azure Key Vault via `SecretProviderClass` (see the AKS example).
4. **Container images pushed to a registry the kubelet can reach.** On AKS, `az aks update --attach-acr <acr>` once per cluster removes the need for `imagePullSecrets`.
5. *(optional)* **Ingress controller + cert-manager `ClusterIssuer`** if `*.ingress.enabled: true`.

---

## 2. Install

```bash
helm install featbit-rda charts/featbit-rda \
  --namespace featbit --create-namespace \
  -f charts/featbit-rda/examples/aks/values.yaml
```

A reference AKS install (NGINX ingress, cert-manager, Key Vault CSI) is documented in [`charts/featbit-rda/examples/aks/`](../../charts/featbit-rda/examples/aks/). A Docker Desktop smoke-test profile lives in [`charts/featbit-rda/examples/local/`](../../charts/featbit-rda/examples/local/).

---

## 3. Upgrade

```bash
helm upgrade featbit-rda charts/featbit-rda \
  -n featbit -f path/to/your/values.yaml
```

---

## Further reading

- [`charts/README.md`](../../charts/README.md) — full chart layout, design decisions, and how to add a new service to the umbrella.
- [`charts/featbit-rda/examples/aks/README.md`](../../charts/featbit-rda/examples/aks/README.md) — end-to-end AKS install with ACR, Key Vault, ingress, and TLS.
- [`AGENTS.md`](../../AGENTS.md) — service map, env vars, metric storage contract.
