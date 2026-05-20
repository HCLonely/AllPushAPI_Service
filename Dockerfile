# Stage 1: Build
FROM node:22-alpine AS builder
WORKDIR /app

COPY package*.json ./
COPY apps/api/package*.json apps/api/
COPY apps/web/package*.json apps/web/

RUN npm ci --workspaces --include-workspace-root

COPY . .

RUN npm run build \
 && npx prisma generate --schema=apps/api/prisma/schema.prisma

# Stage 2: Runtime
FROM node:22-alpine

WORKDIR /app

COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/apps/api/dist ./apps/api/dist
COPY --from=builder /app/apps/api/prisma ./apps/api/prisma
COPY --from=builder /app/apps/web/dist ./apps/web/dist
COPY --from=builder /app/package*.json ./
COPY --from=builder /app/apps/api/package*.json ./apps/api/

COPY docker-entrypoint.sh /
RUN chmod +x /docker-entrypoint.sh

ENV NODE_ENV=production
ENV DATABASE_URL=file:/data/app.db

VOLUME ["/data"]

ENTRYPOINT ["/docker-entrypoint.sh"]
