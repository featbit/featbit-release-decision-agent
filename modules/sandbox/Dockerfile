FROM node:24-slim

# git + ca-certificates for `skills add`; curl so skills can hit HTTP endpoints
# (release-decision skill uses it to load product_facts and check experiment conflicts)
RUN apt-get update && apt-get install -y --no-install-recommends git ca-certificates curl && rm -rf /var/lib/apt/lists/*

# Install Claude Code CLI via pnpm (significantly faster than npm for large packages)
ENV PNPM_HOME="/root/.local/share/pnpm"
ENV PATH="${PNPM_HOME}:${PATH}"
RUN corepack enable pnpm && mkdir -p ${PNPM_HOME} && pnpm add -g @anthropic-ai/claude-code

# Pre-configure Claude Code so that the non-interactive `skills add` step below
# doesn't stall on the first-run onboarding wizard.
RUN mkdir -p /root/.claude && \
    echo '{"hasCompletedOnboarding":true}' > /root/.claude.json

# Global skills directory — populated at runtime via a bind mount from the
# repo's /skills folder (see docker-compose.yml). The repo is private, so the
# old `npx skills add featbit/...` clone no longer works.
RUN mkdir -p /root/.claude/skills

WORKDIR /app

# Copy package manifests first for better layer caching
COPY package.json package-lock.json ./

# Install all dependencies — devDependencies are kept because `tsx` is required
# at runtime by the agent skills (tsx scripts/read-data.ts, tsx scripts/call-api.ts)
RUN npm ci

# Copy source and project files
COPY src ./src
COPY scripts ./scripts
COPY data ./data
COPY .claude ./.claude
COPY CLAUDE.md ./CLAUDE.md
COPY tsconfig.json ./tsconfig.json

# Compile TypeScript → dist/
RUN npm run build

# Entrypoint writes GLM config into ~/.claude at container start
COPY docker-entrypoint.sh /docker-entrypoint.sh
RUN chmod +x /docker-entrypoint.sh

EXPOSE 3000

ENTRYPOINT ["/docker-entrypoint.sh"]
CMD ["node", "dist/server.js"]
