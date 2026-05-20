#!/bin/sh
set -e

cd /app
npx prisma db push --skip-generate --schema=apps/api/prisma/schema.prisma

exec node apps/api/dist/index.js
