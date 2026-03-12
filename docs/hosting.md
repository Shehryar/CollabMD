# Hosting Options

CollabMD needs two always-on services: the Next.js web app and the y-websocket sync server. The sync server maintains persistent WebSocket connections, which rules out serverless platforms for that component.

## Option A: Single VPS with Docker Compose (recommended)

Run everything on one machine with `docker-compose.prod.yml`. Caddy handles TLS automatically via Let's Encrypt.

**Services:** Caddy (reverse proxy) → web (Next.js) + sync-server (y-websocket) + OpenFGA
**Database:** Supabase (managed Postgres, external)
**Cost:** ~$6/mo (DigitalOcean droplet) + Supabase free tier

See [deployment guide](./deployment.md) for setup instructions.

## Option B: Hybrid managed hosting

Split the web app and sync server across different platforms to get the best of managed hosting.

### Web app → Vercel (free tier)

The Next.js app works well on Vercel since it's stateless (DB is external via Supabase, auth sessions are DB-backed). Benefits:

- Zero-config deploys from git push
- Edge CDN, automatic preview deploys
- Free tier covers most small-team usage
- No Docker needed for the web app

Setup:
1. Connect the repo to Vercel, set root directory to `apps/web`
2. Set build command: `cd ../.. && pnpm install && pnpm --filter @collabmd/shared build && pnpm --filter @collabmd/db build && pnpm --filter @collabmd/web build`
3. Set output directory: `apps/web/.next`
4. Add environment variables: `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL` (your Vercel domain), `NEXT_PUBLIC_SYNC_URL` (wss://sync.yourdomain.com), `DATABASE_URL` (Supabase connection string), `OPENFGA_URL`

### Sync server → Fly.io (~$3-5/mo)

The sync server needs persistent WebSocket connections, so it runs on Fly.io as a long-running process.

Setup:
1. Create `fly.toml` in `apps/sync-server/`:
```toml
app = "collabmd-sync"
primary_region = "iad"

[build]
  dockerfile = "Dockerfile"

[env]
  PORT = "4444"
  NODE_ENV = "production"

[http_service]
  internal_port = 4444
  force_https = true

[[services.ports]]
  handlers = ["tls", "http"]
  port = 443

[checks.health]
  type = "http"
  port = 4444
  path = "/health"
  interval = "10s"
  timeout = "5s"
```

2. Deploy: `fly deploy --dockerfile ../../apps/sync-server/Dockerfile`
3. Set secrets: `fly secrets set DATABASE_URL=... BETTER_AUTH_URL=...`

### OpenFGA → Fly.io or Okta FGA (managed)

Options:
- **Self-hosted on Fly.io:** Run the OpenFGA Docker image (~$3-5/mo), configure with Postgres backend (can share the Supabase instance)
- **Okta FGA (managed):** Free tier available at fga.dev, no infra to manage. Set `OPENFGA_URL` to the managed endpoint.

### Hybrid cost estimate

| Service | Platform | Cost |
|---|---|---|
| Web app | Vercel | Free |
| Sync server | Fly.io | ~$3-5/mo |
| OpenFGA | Fly.io or Okta FGA | ~$3-5/mo or free |
| Database | Supabase | Free tier |
| **Total** | | **$0-10/mo** |

### Trade-offs vs single VPS

| | Single VPS | Hybrid |
|---|---|---|
| Simplicity | One machine, one compose file | 3 platforms to manage |
| Deploys | SSH + docker compose pull | git push (Vercel) + fly deploy |
| Scaling | Manual (bigger droplet) | Auto-scale per service |
| Cost | ~$6/mo flat | $0-10/mo variable |
| TLS | Caddy (self-managed) | Handled by each platform |
| Monitoring | DIY | Platform dashboards |

For a small team, the single VPS is simpler. The hybrid approach makes sense if you want zero-ops on the web app and are comfortable managing Fly.io for the sync server.

## Option C: Cloudflare Durable Objects (future)

Cloudflare Durable Objects natively support WebSocket hibernation, which is architecturally ideal for a CRDT sync server. Each document could be its own Durable Object, handling connections at the edge with automatic scaling.

This would require rewriting the sync server to use the Durable Objects API instead of y-websocket. The Yjs ecosystem has experimental Durable Objects adapters (y-durableobjects) but they're not production-ready yet. Worth revisiting as the ecosystem matures.
