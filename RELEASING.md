# Releasing

Release flow modelled on [`featbit/featbit`](https://github.com/featbit/featbit) (Docker images) +
[`featbit/featbit-charts`](https://github.com/featbit/featbit-charts) (Helm chart).

## What ships in one release

A single `Release` workflow run produces, all tagged with the same version (e.g. `0.4.0`):

| # | Artefact | Coordinate |
|---|---|---|
| 1 | Docker image | `featbit/featbit-rda-track-service:<version>` (Docker Hub) |
| 2 | Docker image | `featbit/featbit-rda-web:<version>` (Docker Hub) |
| 3 | npm package | `@featbit/experimentation-claude-code-connector@<version>` |
| 4 | Skills bundle | `skills-<version>.tar.gz` attached to GitHub Release `v<version>` |

The Helm chart is released separately (see "Chart release" below) — it depends on (1) and (2) being out first.

## Workflows

| Workflow | File | Trigger | Output |
|---|---|---|---|
| Release | [`.github/workflows/release.yml`](.github/workflows/release.yml) | Manual (`workflow_dispatch`) | All four artefacts above + GH Release `v<version>` |
| Release Charts | [`.github/workflows/release-charts.yml`](.github/workflows/release-charts.yml) | Push to `main` under `charts/**` | New chart Release + updated `index.yaml` on `gh-pages` |

## One-time GitHub setup

1. **Create a `Production` environment** in repo Settings → Environments → New environment → name it `Production` (capital P, matches the `environment:` key in the workflows).
2. **Add release secrets to the `Production` environment**:
   - `DOCKER_HUB_USERNAME` — Docker Hub user/org. Must be `featbit` to publish under the official namespace.
   - `DOCKER_HUB_ACCESS_TOKEN` — Docker Hub PAT with `Read, Write, Delete` on the `featbit` namespace.
   - `NPM_TOKEN` — npm Automation token with publish rights on the `@featbit` scope.
3. **Workflow permissions** — Settings → Actions → General → Workflow permissions → "Read and write permissions". The release job commits the connector's `package.json` bump back to `main` and creates Release tags; chart-releaser writes `gh-pages`.
4. *(Chart release only)* After the first chart Release succeeds, flip Settings → Pages → Source = `gh-pages` / `(root)` so the index becomes browseable at `https://featbit.github.io/featbit-release-decision-agent`.

## Cutting a release

1. Go to GitHub → Actions → **Release** → Run workflow:
   - **version**: `0.4.0` (no leading `v` — the workflow validates SemVer)
   - **build-latest**: usually leave off; flip on for stable cuts you want `:latest` to follow.

   The web image bakes in `NEXT_PUBLIC_FEATBIT_API_URL=https://app-api.featbit.co` (the FeatBit SaaS backend) at build time — this default lives in `modules/web/Dockerfile`, not in the workflow, so the release always ships a SaaS-ready image. Self-hosters of FeatBit who need a different backend rebuild the image themselves with `docker build --build-arg NEXT_PUBLIC_FEATBIT_API_URL=...`.
2. Wait for all jobs to go green:
   - `preflight` validates the version and refuses if `v<version>` already exists.
   - `docker (featbit-rda-track-service)` and `docker (featbit-rda-web)` build multi-arch and push.
   - `npm` bumps `modules/experimentation-claude-code-connector/package.json`, publishes to npm with provenance, then commits the bump back to `main`.
   - `release` packages `skills/` as a tarball and creates the `v<version>` GitHub Release with the tarball + sha256 attached and auto-generated changelog.
3. Verify on Docker Hub, npmjs.com, and the GitHub Releases page.

If a job fails partway, the release is partial — fix the cause, then re-run with the **same** version (since `preflight` keys on the git tag, you may need to delete the tag first if the `release` job created it before failing).

## Chart release (do this after the image release)

The chart workflow auto-runs on every push to `main` that touches `charts/**`, but only publishes if `Chart.yaml`'s `version:` is **new** (i.e. no existing GitHub Release tag matches `featbit-rda-<version>`).

1. Bump image tags in `charts/featbit-rda/values.yaml` to the just-published `<version>`.
2. Bump `version:` (and usually `appVersion:`) in `charts/featbit-rda/Chart.yaml`. Use SemVer; chart-releaser refuses to re-release a version that already has a Release.
3. Commit + merge to `main`.
4. The `Release Charts` workflow runs, creates GitHub Release `featbit-rda-<version>`, attaches the packaged `.tgz`, and pushes the updated `index.yaml` to `gh-pages`.

## Consuming what was published

```bash
# Docker images
docker pull featbit/featbit-rda-track-service:0.4.0
docker pull featbit/featbit-rda-web:0.4.0

# npm package
npx @featbit/experimentation-claude-code-connector@0.4.0

# Skills bundle
curl -L -o skills.tar.gz \
  https://github.com/featbit/featbit-release-decision-agent/releases/download/v0.4.0/skills-0.4.0.tar.gz
tar -xzf skills.tar.gz -C ~/.claude/

# Helm chart (after first chart release + GitHub Pages enabled)
helm repo add featbit-rda https://featbit.github.io/featbit-release-decision-agent
helm repo update
helm install my-rda featbit-rda/featbit-rda --version 0.3.0
```
