FROM node:20-slim

# Install Claude Code CLI (latest stable)
RUN npm install -g @anthropic-ai/claude-code

# Pre-configure Claude Code so that the non-interactive `skills add` step below
# doesn't stall on the first-run onboarding wizard.
RUN mkdir -p /root/.claude && \
    echo '{"hasCompletedOnboarding":true}' > /root/.claude.json

# Install skills from the featbit release-decision-agent repo.
# They are placed into /root/.claude/skills/ at build time so they are always
# available inside the container without any manual setup.
RUN npx --yes skills add featbit/featbit-release-decision-agent --all -g -a claude-code -y

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
