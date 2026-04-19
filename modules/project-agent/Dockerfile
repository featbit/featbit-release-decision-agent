FROM node:20-slim AS base

# ── Stage 1: install deps ──────────────────────────────────────────────────────
FROM base AS deps
WORKDIR /build/modules/project-agent
COPY modules/project-agent/package.json modules/project-agent/package-lock.json ./
RUN npm ci

# ── Stage 2: build ─────────────────────────────────────────────────────────────
FROM base AS builder
WORKDIR /build
# prepare-skills.ts resolves skills-project/ two levels above module root;
# replicate that layout so the script finds its source files.
COPY skills-project/ ./skills-project/
COPY modules/project-agent/ ./modules/project-agent/
COPY --from=deps /build/modules/project-agent/node_modules ./modules/project-agent/node_modules
WORKDIR /build/modules/project-agent
RUN npm run build

# ── Stage 3: runner ────────────────────────────────────────────────────────────
FROM base AS runner
# The bundled Codex binary is a musl Rust binary that reads TLS certs from
# the OS store — not from Node's built-in bundle. Without ca-certificates the
# binary fails every HTTPS connection (e.g. to Azure AI Foundry).
RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /app

RUN groupadd --system --gid 1001 nodejs \
 && useradd  --system --uid 1001 --gid nodejs nodeapp

# Runtime artifacts
COPY --from=builder --chown=nodeapp:nodejs /build/modules/project-agent/dist        ./dist
COPY --from=builder --chown=nodeapp:nodejs /build/modules/project-agent/node_modules ./node_modules
COPY --from=builder --chown=nodeapp:nodejs /build/modules/project-agent/skills       ./skills
COPY --from=builder --chown=nodeapp:nodejs /build/modules/project-agent/scripts      ./scripts
COPY --from=builder --chown=nodeapp:nodejs /build/modules/project-agent/AGENTS.md   ./AGENTS.md

# codex-config/ is volume-mounted at runtime (config.toml + no secrets in image)
# /app/.codex is used by the Codex binary for workspace-level state; must be
# writable by the container user.
RUN mkdir -p /app/codex-config /app/.codex \
 && chown nodeapp:nodejs /app/codex-config /app/.codex

USER nodeapp

EXPOSE 3031
ENV PORT=3031
ENV NODE_ENV=production
ENV CODEX_HOME=/app/codex-config

CMD ["node", "dist/server.js"]
