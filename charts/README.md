# FeatBit RDA Helm chart

Helm chart for deploying FeatBit Release Decision Agent (`modules/*`) to Kubernetes — production-grade install with autoscaling, ingress + TLS, and secret projection from Key Vault.

The chart is deliberately cloud-neutral. It does **not** provision PostgreSQL or ClickHouse, and it does **not** apply any DDL.

---

## Install

```bash
helm install featbit-rda charts/featbit-rda \
  --namespace featbit-rda --create-namespace \
  -f charts/featbit-rda/examples/aks/values.aks.local.yaml
```

A reference AKS install (NGINX ingress, cert-manager, Key Vault CSI) is documented in [`featbit-rda/examples/aks/`](featbit-rda/examples/aks/) — start from the public template `values.yaml`, copy to `values.aks.local.yaml`, fill in the marked fields, then install with the command above. A Docker Desktop smoke-test profile lives in [`featbit-rda/examples/local/`](featbit-rda/examples/local/).

## Upgrade

```bash
helm upgrade featbit-rda charts/featbit-rda \
  -n featbit-rda \
  -f charts/featbit-rda/examples/aks/values.aks.local.yaml
```

---

## Prerequisites you MUST provision before `helm install`

A few things must exist *before* you run `helm install`, or pods will fail to start:

1. **PostgreSQL database** reachable from the cluster (used by the `web` service). The role in the connection string needs `CREATE` / `ALTER` privileges — `web` runs `prisma migrate deploy` on every start.

2. **ClickHouse database and tables** *(only if you keep `track-service`)*. The chart writes to `<database>.flag_evaluations` and `<database>.metric_events`. `<database>` is controlled by `trackService.clickHouse.database` in your values — make it match the DB on your CH where those tables already exist. Reference schema: [`../modules/track-service/sql/schema.sql`](../modules/track-service/sql/schema.sql).

3. **A Kubernetes Secret holding the ClickHouse connection string.** The chart consumes this via `trackService.clickHouse.existingSecret`. For AKS this is typically **projected from Azure Key Vault** by applying a `SecretProviderClass` manifest (see [`featbit-rda/examples/aks/keyvault-secret-provider.yaml`](featbit-rda/examples/aks/keyvault-secret-provider.yaml)) **before** installing the chart. The SPC is intentionally *not* part of this chart — SPC is Azure-specific infrastructure plumbing, the chart is the application. For dev you can skip the SPC and just set `trackService.clickHouse.connectionString` directly; the chart will generate the Secret itself.

4. **Container images pushed to a registry the kubelet can reach.** On AKS: `az aks update --attach-acr <acr>` once per cluster removes the need for `imagePullSecrets`.

5. *(optional)* **Ingress controller + cert-manager `ClusterIssuer`** — only needed if `trackService.ingress.enabled: true` (or any other `*.ingress.enabled`).

---

## Layout

```
charts/
└── featbit-rda/                     # single umbrella chart for all RDA services
    ├── Chart.yaml
    ├── values.yaml                  # top-level keys per service: trackService, ...
    ├── templates/
    │   ├── _helpers.tpl
    │   ├── NOTES.txt
    │   ├── track-service-*.yaml     # Deployment, Service, Ingress, HPA, PDB, Secret, SA
    │   └── ... (future services)
    └── examples/
        ├── aks/                     # Azure AKS example (ACR + NGINX + cert-manager + Key Vault)
        │   ├── README.md
        │   ├── values.yaml
        │   ├── keyvault-secret-provider.yaml
        │   └── cluster-issuer.yaml
        └── local/                   # Docker Desktop Kubernetes smoke test
            ├── README.md
            └── values.yaml
```

## Design decisions

- **Umbrella chart, not per-service charts.** One `helm install` deploys everything; each service is toggled via `<service>.enabled`. This matches the pattern used in [featbit-charts](https://github.com/featbit/featbit-charts).
- **NGINX Ingress, not one LoadBalancer per service.** Single public IP, routing by `Host:`, free TLS via cert-manager + Let's Encrypt.
- **Image registry = Azure Container Registry.** AKS is attached to the ACR via `az aks update --attach-acr`, so no `imagePullSecrets` are required.
- **Secrets.** Dev/staging path: put plain values in `values.local.yaml` and the chart generates a Secret. Production path: project secrets from Azure Key Vault via the CSI driver; the chart just reads the Secret the driver creates.

## Adding a new service

1. Add a section to `charts/featbit-rda/values.yaml` (e.g. `statsService:`).
2. Add `charts/featbit-rda/templates/stats-service-{deployment,service,ingress,hpa,pdb,serviceaccount}.yaml`, all gated on `.Values.statsService.enabled`.
3. Add helpers (`statsService.fullname`, `statsService.image`, …) to `_helpers.tpl`.
4. Extend `examples/aks/values.yaml` with the new service's overrides.

## Further reading

- [`featbit-rda/examples/aks/README.md`](featbit-rda/examples/aks/README.md) — end-to-end AKS install with ACR, Key Vault, ingress, and TLS.
- [`../AGENTS.md`](../AGENTS.md) — service map, env vars, metric storage contract.
