# CollabMD

## Production Deployment

Live at: https://collabmd.dev
Droplet: 137.184.197.113 (DigitalOcean, ID 557636695)
Registry: registry.digitalocean.com/collabmd (private)
Repo on droplet: /opt/collabmd/repo

### Deploy workflow

CRITICAL: Never run build in background or pipe through `tail` — a failed build silently pushes the stale old image. Always verify build exit code before pushing.

1. Build images locally (must cross-compile for linux/amd64):
   ```
   docker build --platform linux/amd64 --no-cache -t ghcr.io/shehryar/collabmd-web:latest -f apps/web/Dockerfile . 2>&1 | tee /tmp/web-build.log
   docker build --platform linux/amd64 --no-cache -t ghcr.io/shehryar/collabmd-sync-server:latest -f apps/sync-server/Dockerfile . 2>&1 | tee /tmp/sync-build.log
   ```
2. Verify build succeeded (check exit code AND new image ID):
   ```
   docker images ghcr.io/shehryar/collabmd-web:latest --format '{{.ID}} {{.CreatedAt}}'
   ```
3. Push to registry:
   ```
   docker push ghcr.io/shehryar/collabmd-web:latest
   docker push ghcr.io/shehryar/collabmd-sync-server:latest
   ```
4. Deploy on droplet:
   ```
   ssh root@137.184.197.113 "cd /opt/collabmd/repo && docker compose -f docker-compose.prod.yml pull && docker compose -f docker-compose.prod.yml up -d"
   ```
5. Verify deployed image matches local:
   ```
   ssh root@137.184.197.113 "docker images ghcr.io/shehryar/collabmd-web:latest --format '{{.ID}}'"
   ```
6. Prune old images on droplet (keeps last 48h for rollback):
   ```
   ssh root@137.184.197.113 "docker image prune -af --filter 'until=48h'"
   ```

### What requires a rebuild

Changes to these files require rebuilding and pushing the Docker image:

- `packages/db/src/client.ts` -- baked into web + sync-server images via packages/db/dist/
- `packages/db/src/schema-pg.ts` -- same, Postgres schema
- `packages/db/src/search.ts` -- same, search abstraction
- `apps/web/src/**` -- web image
- `apps/sync-server/src/**` -- sync-server image
- `packages/shared/src/**` -- both images (shared is built during Docker build)
- `apps/web/Dockerfile` or `apps/sync-server/Dockerfile` -- respective image

### What only requires a restart (no rebuild)

Environment variable changes in `.env` on the droplet only need a restart:
```
ssh root@137.184.197.113 "cd /opt/collabmd/repo && docker compose -f docker-compose.prod.yml restart web sync-server"
```

Exception: `NEXT_PUBLIC_*` env vars are baked into the Next.js client bundle at build time and require a web image rebuild.

### What only requires a file copy + restart

- `Caddyfile` -- scp then `docker compose restart caddy`
- `docker-compose.prod.yml` -- scp then `docker compose up -d`

### Key gotchas

- Never build Docker images on the droplet -- it's a small VPS and will OOM. Always build locally and push to registry.
- The web Dockerfile installs `postgres` and `drizzle-orm` via npm in /tmp during the runner stage because pnpm symlinks don't survive Docker COPY, and Next.js standalone tracer can't follow createRequire dynamic imports.
- `packages/db/src/client.ts` uses createRequire to dynamically load `postgres`, `drizzle-orm/postgres-js`, and `./schema-pg.js`. These are NOT statically imported.
- Supabase pooler requires `prepare: false` (transaction mode) and `ssl: 'require'`. This is auto-detected in client.ts via the connection string.
- Supabase IPv4 pooler hostname is `aws-1-us-east-1.pooler.supabase.com` (NOT `aws-0`). Direct connection is IPv6 only, unreachable from the droplet.
- OpenFGA runs on its own local Postgres container (not Supabase) because of the IPv6 issue. It uses a migrate-then-run pattern in docker-compose.
- The OpenFGA image is distroless (no shell, no wget, no curl). Healthcheck uses a curl sidecar container.
- `BETTER_AUTH_URL` must match the public URL exactly or all POST requests get 403 (CSRF).
- `NEXT_PUBLIC_SYNC_URL` must use `wss://` in production (not `ws://`).
- OpenFGA tuples are the source of truth for permissions. If the OpenFGA volume is lost, only baseline tuples (ownership, org, folder containment) can be reconstructed from Supabase. Explicit per-user shares are lost. A `permission_audit_log` table is planned to fix this.

### Security hardening (2026-04-01)

- Sync server HTTP endpoints (`/snapshot`, `/replace`, `/connections`, `/notifications/broadcast`) require `x-collabmd-internal-secret` header. Web app sends via `getSyncInternalHeaders()` from `lib/sync-internal-auth.ts`.
- `SYNC_SERVER_INTERNAL_SECRET` env var on droplet (falls back to `BETTER_AUTH_SECRET`). Both web and sync-server must share the same value.
- Webhook URLs validated against private IPs, localhost, link-local, single-label hostnames, and DNS-resolved addresses (`lib/webhook-url.ts`). Webhook fetch uses `redirect: 'error'` to prevent redirect-based SSRF.
- CLI auth uses one-time code exchange (`lib/cli-auth.ts`, `/api/auth/cli-exchange`) instead of raw session tokens.
- CSP set in `next.config.ts`, HSTS/X-Frame-Options/nosniff in Caddyfile. CSP `form-action` allows `http://127.0.0.1:*` for CLI callback.
- Auth rate limiting: 5/min for magic link, 20/min for other auth POST. Share link passwords: 5 attempts per 15min per token.
- `BETTER_AUTH_URL` and `SYNC_SERVER_INTERNAL_SECRET` both required in production (sync server throws on startup if missing).
- All containers have `security_opt: no-new-privileges:true`. Web and sync-server run as non-root users.
- OpenFGA DB credentials are env-var driven (`OPENFGA_DB_USER`, `OPENFGA_DB_PASSWORD`) in prod compose.

### Log rotation

- Docker: `/etc/docker/daemon.json` sets `max-size: 10m`, `max-file: 3` per container (30MB max per container)
- Systemd journal: `/etc/systemd/journald.conf.d/size.conf` caps at 100M
- Old Docker images pruned at deploy time (step 6 above)

### Email (Loops)

- Magic link emails sent via Loops transactional API
- Template ID: cmmuvel4g03md0izahzdv8ck3 (data var: magicLinkUrl)
- Share invite template: not yet created
- DNS records for mail.collabmd.dev verified (MX, SPF, DMARC, DKIM)
- Env vars: LOOPS_API_KEY, LOOPS_MAGIC_LINK_TRANSACTIONAL_ID, LOOPS_SHARE_INVITE_TRANSACTIONAL_ID

### Progress tracking

Progress file: `~/Documents/Notes/AI/Projects/Local-First-Collab-Docs/Progress.md` (may be stale, treat MEMORY.md as more current)

## Local Development

- Always start with `pnpm dev` from repo root
- Wait for "OpenFGA auth model written" log before using the app
- Dev uses SQLite, prod uses Postgres -- runtime detection via DATABASE_URL prefix
