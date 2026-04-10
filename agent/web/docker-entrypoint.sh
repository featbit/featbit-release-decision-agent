#!/bin/sh
set -e

echo "=== Running Prisma migrations ==="
npx prisma migrate deploy

echo "=== Creating event tables ==="
npx prisma db execute --file /init-events.sql

echo "=== Seeding test data ==="
npx tsx prisma/seed-worker-test.ts

echo "=== Starting Next.js ==="
exec npm run start
