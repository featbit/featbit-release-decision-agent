# Releasing

Release flow modelled on [`featbit/featbit`](https://github.com/featbit/featbit) (Docker images) +
[`featbit/featbit-charts`](https://github.com/featbit/featbit-charts) (Helm chart).

Two GitHub Actions workflows do all the work:

| Workflow | File | Trigger | Output |
|---|---|---|---|
| Publish Docker Images | [`.github/workflows/publish-docker-images.yml`](.github/workflows/publish-docker-images.yml) | Manual (`workflow_dispatch`) | Multi-arch images on Docker Hub: `featbit/featbit-rda-track-service:<version>` and `featbit/featbit-rda-web:<version>` |
| Release Charts | [`.github/workflows/release-charts.yml`](.github/workflows/release-charts.yml) | Push to `main` under `charts/**` | A new GitHub Release `featbit-rda-<chart-version>` containing the packaged `.tgz`, plus an updated `index.yaml` on the `gh-pages` branch |

## One-time GitHub setup

1. **Create a `Production` environment** in repo Settings → Environments → New environment → name it `Production` (capital P, matches the `environment:` key in both workflows).
2. **Add Docker Hub secrets to the `Production` environment**:
   - `DOCKER_HUB_USERNAME` — Docker Hub user/org that owns the images. Must be `featbit` to publish under the official namespace.
   - `DOCKER_HUB_ACCESS_TOKEN` — Docker Hub PAT with `Read, Write, Delete` on the `featbit` namespace.
3. **Enable a `gh-pages` branch** for the Helm repo. The chart-releaser action will create it on first run if missing; you only need to flip Settings → Pages → Source = `gh-pages` / `/ (root)` *after* the first successful chart release so the index becomes browseable at `https://featbit.github.io/featbit-release-decision-agent`.
4. **Workflow permissions** — Settings → Actions → General → Workflow permissions → "Read and write permissions". chart-releaser needs this to push to `gh-pages` and create releases.

## Cutting an image release

When you've merged code changes that need to ship in a new image:

1. Decide the version (e.g. `0.4.0` for track-service, or whatever you'll pin in `values.yaml` next).
2. GitHub → Actions → **Publish Docker Images** → Run workflow:
   - **version**: `0.4.0`
   - **build-latest**: usually leave off; flip on for stable cuts you want `:latest` to follow.
   - **next-public-featbit-api-url**: defaults to `https://app-api.featbit.co` (FeatBit SaaS). Override if you're publishing an image targeting a self-hosted FeatBit backend — this value is baked into the web bundle and cannot be changed at runtime.
3. Wait for both matrix jobs (`featbit-rda-track-service`, `featbit-rda-web`) to go green. Verify on Docker Hub.

## Cutting a chart release

The chart release is automatic on every push to `main` that touches `charts/**`, but only publishes when `Chart.yaml`'s `version:` is **new** (i.e. no existing GitHub Release tag matches `featbit-rda-<version>`). Workflow:

1. Bump image tags in `charts/featbit-rda/values.yaml` to the just-published version(s).
2. Bump `version:` (and usually `appVersion:`) in `charts/featbit-rda/Chart.yaml`. Use SemVer; chart-releaser refuses to re-release a version that already has a Release.
3. Commit + merge to `main`.
4. The `Release Charts` workflow runs, creates GitHub Release `featbit-rda-<version>`, attaches the packaged `.tgz`, and pushes the updated `index.yaml` to `gh-pages`.

## Consuming the published chart

Once the first chart release ships and `gh-pages` is exposed via GitHub Pages:

```bash
helm repo add featbit-rda https://featbit.github.io/featbit-release-decision-agent
helm repo update
helm install my-rda featbit-rda/featbit-rda --version 0.2.0
```

Until then, point `helm install` at the local checkout (the existing flow documented in `charts/README.md`).

## Recommended cadence

- Publish images first; verify by pulling them in a smoke environment.
- Then bump `values.yaml` + `Chart.yaml` in a single commit so the chart release strictly follows working images.
- Image tags and chart `appVersion` don't have to match each other — track-service and web typically version independently — but the chart's own `version:` must always be bumped per release.
