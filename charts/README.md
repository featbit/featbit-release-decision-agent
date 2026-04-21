# charts/

Helm charts for deploying the FeatBit Release Decision Agent (modules/*) to Kubernetes.

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

The chart never provisions ClickHouse or applies DDL — the target DB and
tables (see `modules/track-service/sql/schema.sql` for the reference schema)
are assumed to exist.

## Prerequisites you MUST provision before `helm install`

The chart deliberately stays cloud-neutral. A few things must exist *before*
you run `helm install`, or pods will fail to start:

1. **ClickHouse DB and tables.** The chart writes to `<database>.flag_evaluations`
   and `<database>.metric_events`. `<database>` is controlled by
   `trackService.clickHouse.database` in your values — make it match the DB
   on your CH where those tables already exist.

2. **A Kubernetes Secret holding the ClickHouse connection string.**
   The chart consumes this via `trackService.clickHouse.existingSecret`.
   For AKS this is typically **projected from Azure Key Vault** by applying
   a `SecretProviderClass` manifest (see `featbit-rda/examples/aks/keyvault-secret-provider.yaml`)
   **before** installing the chart. The SPC is intentionally *not* part of
   this chart — SPC is Azure-specific infrastructure plumbing, the chart
   is the application. For dev you can skip the SPC and just set
   `trackService.clickHouse.connectionString` directly; the chart will
   generate the Secret itself.

3. **Image pulled from a registry the AKS kubelet can reach.** For AKS:
   `az aks update --attach-acr <acr>` once per cluster.

4. **Ingress controller + (optional) cert-manager ClusterIssuer.** Only
   needed if `trackService.ingress.enabled: true`.

## Design decisions

- **Umbrella chart, not per-service charts.** One `helm install` deploys
  everything; each service is toggled via `<service>.enabled`. This matches
  the pattern used in [featbit-charts](https://github.com/featbit/featbit-charts).
- **NGINX Ingress, not one LoadBalancer per service.** Single public IP,
  routing by `Host:`, free TLS via cert-manager + Let's Encrypt.
- **Image registry = Azure Container Registry.** AKS is attached to the ACR
  via `az aks update --attach-acr`, so no `imagePullSecrets` are required.
- **Secrets.** Dev/staging path: put plain values in `values.local.yaml` and
  the chart generates a Secret. Production path: project secrets from Azure
  Key Vault via the CSI driver; the chart just reads the Secret the driver
  creates.

## Adding a new service

1. Add a section to `charts/featbit-rda/values.yaml` (e.g. `statsService:`).
2. Add `charts/featbit-rda/templates/stats-service-{deployment,service,ingress,hpa,pdb,serviceaccount}.yaml`,
   all gated on `.Values.statsService.enabled`.
3. Add helpers (`statsService.fullname`, `statsService.image`, …) to `_helpers.tpl`.
4. Extend `examples/aks/values.yaml` with the new service's overrides.

## Quick start

See [`featbit-rda/examples/aks/README.md`](featbit-rda/examples/aks/README.md).
