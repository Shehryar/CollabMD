# ---- base ----
FROM node:22-slim AS base
RUN corepack enable && corepack prepare pnpm@10.28.1 --activate
WORKDIR /app

# ---- deps ----
FROM base AS deps

# Copy workspace config
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./

# Copy all package.json files for workspace packages
COPY apps/web/package.json ./apps/web/
COPY apps/sync-server/package.json ./apps/sync-server/
COPY packages/shared/package.json ./packages/shared/
COPY packages/db/package.json ./packages/db/
COPY packages/collabmd/package.json ./packages/collabmd/
COPY packages/create-collabmd/package.json ./packages/create-collabmd/
COPY packages/mcp-server/package.json ./packages/mcp-server/

RUN pnpm install --frozen-lockfile

# ---- builder ----
FROM base AS builder

COPY --from=deps /app/ /app/
COPY . .

RUN pnpm --filter @collabmd/shared build && \
    pnpm --filter @collabmd/db build && \
    pnpm --filter @collabmd/sync-server build

# ---- runner ----
FROM node:22-slim AS runner
WORKDIR /app

ENV NODE_ENV=production

RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 appuser

# Copy built output and dependencies
COPY --from=builder /app/apps/sync-server/dist ./dist
COPY --from=builder /app/apps/sync-server/node_modules ./node_modules
COPY --from=builder /app/apps/sync-server/package.json ./package.json

# Copy workspace package dist outputs (needed at runtime)
COPY --from=builder /app/packages/shared/dist ./packages/shared/dist
COPY --from=builder /app/packages/shared/package.json ./packages/shared/package.json
COPY --from=builder /app/packages/db/dist ./packages/db/dist
COPY --from=builder /app/packages/db/package.json ./packages/db/package.json
COPY --from=builder /app/packages/db/node_modules ./packages/db/node_modules

# Install wget for healthcheck
RUN apt-get update && apt-get install -y --no-install-recommends wget && rm -rf /var/lib/apt/lists/*

EXPOSE 4444
ENV PORT=4444

USER appuser

CMD ["node", "dist/index.js"]
