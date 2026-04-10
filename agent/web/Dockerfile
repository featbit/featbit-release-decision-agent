# ── Build stage ──────────────────────────────────────────────────────────────
FROM node:22-alpine AS build
WORKDIR /app

# NEXT_PUBLIC_ vars are baked into the JS bundle at build time.
# Default to localhost:3001 (dev); override via --build-arg in docker-compose.
ARG NEXT_PUBLIC_SANDBOX_URL=http://localhost:3001
ENV NEXT_PUBLIC_SANDBOX_URL=$NEXT_PUBLIC_SANDBOX_URL

COPY package.json package-lock.json ./
RUN npm ci

COPY prisma/ ./prisma/
COPY prisma.config.ts tsconfig.json next.config.ts next-env.d.ts components.json postcss.config.mjs eslint.config.mjs ./
COPY src/ ./src/
COPY public/ ./public/

# Generate Prisma client (needs DATABASE_URL at build time for schema only)
ENV DATABASE_URL="postgresql://dummy:dummy@localhost:5432/dummy"
RUN npx prisma generate

RUN npm run build

# ── Runtime stage ────────────────────────────────────────────────────────────
FROM node:22-alpine AS runtime
WORKDIR /app

# Install tsx for running seed scripts at startup
RUN npm install -g tsx

COPY --from=build /app/package.json /app/package-lock.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/.next ./.next
COPY --from=build /app/public ./public
COPY --from=build /app/prisma ./prisma
COPY --from=build /app/prisma.config.ts ./
COPY --from=build /app/tsconfig.json ./
COPY --from=build /app/src/generated ./src/generated

COPY docker-entrypoint.sh /docker-entrypoint.sh
RUN chmod +x /docker-entrypoint.sh

EXPOSE 3000
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

ENTRYPOINT ["/docker-entrypoint.sh"]
