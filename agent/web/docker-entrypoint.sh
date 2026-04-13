#!/bin/sh
set -e

if [ "${RUN_DB_BOOTSTRAP:-false}" = "true" ]; then
	echo "=== Running Prisma migrations ==="
	npx prisma migrate deploy

	if [ -f /init-events.sql ]; then
		echo "=== Creating event tables ==="
		npx prisma db execute --file /init-events.sql
	else
		echo "=== Skipping event tables bootstrap (file not found: /init-events.sql) ==="
	fi
else
	echo "=== Skipping DB bootstrap (set RUN_DB_BOOTSTRAP=true to enable migrations) ==="
fi

echo "=== Starting Next.js ==="
exec npm run start
