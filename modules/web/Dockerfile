FROM node:20-alpine AS base

# ── Stage 1: Install dependencies ───────────────────────────────────────────
FROM base AS deps
RUN apk add --no-cache libc6-compat openssl
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

# ── Stage 2: Build the application ──────────────────────────────────────────
FROM base AS builder
RUN apk add --no-cache libc6-compat openssl
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Build-time public env baked into the Next.js bundle. Defaults to the FeatBit
# SaaS backend so the published image works out of the box for SaaS users.
# Self-hosters of FeatBit override this with `--build-arg` when rebuilding.
ARG NEXT_PUBLIC_FEATBIT_API_URL=https://app-api.featbit.co
ENV NEXT_PUBLIC_FEATBIT_API_URL=${NEXT_PUBLIC_FEATBIT_API_URL}

ENV NEXT_TELEMETRY_DISABLED=1

# Generate Prisma client for the target platform (linux-musl / Alpine)
RUN npx prisma generate

RUN npm run build

# ── Stage 3: Production runner ───────────────────────────────────────────────
FROM base AS runner
RUN apk add --no-cache openssl
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nextjs

# Static assets and standalone server bundle
COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

# Prisma generated client + native query engine binary
COPY --from=builder --chown=nextjs:nodejs /app/src/generated/prisma ./src/generated/prisma

# Markdown specs read at runtime by /data-warehouse/customer-endpoints/schema.
# Standalone build doesn't bundle source files outside .next/, so copy
# explicitly. Tiny (a handful of KB).
COPY --from=builder --chown=nextjs:nodejs /app/docs ./docs

USER nextjs

EXPOSE 3000
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

CMD ["node", "server.js"]
