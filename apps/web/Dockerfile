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

ENV DOCKER_BUILD=1
# Dummy secrets for Next.js build-time page data collection (not used at runtime)
ENV BETTER_AUTH_SECRET=build-time-placeholder
ENV BETTER_AUTH_URL=http://localhost:3000

RUN pnpm --filter @collabmd/shared build && \
    pnpm --filter @collabmd/db build && \
    pnpm --filter @collabmd/web build

# ---- runner ----
FROM node:22-slim AS runner
WORKDIR /app

ENV NODE_ENV=production

RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 nextjs

COPY --from=builder /app/apps/web/.next/standalone ./
COPY --from=builder /app/apps/web/.next/static ./apps/web/.next/static

EXPOSE 3000
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

USER nextjs

CMD ["node", "apps/web/server.js"]
