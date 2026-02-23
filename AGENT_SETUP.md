# CollabMD Agent Setup

Paste this into Claude Code, Cursor, or any AI agent to help it understand and work with CollabMD.

---

## What is CollabMD

CollabMD is a collaborative markdown editor. Local `.md` files, a web editor, and AI agents all sync in real time via CRDTs (Yjs). You're working on a pnpm + Turborepo monorepo.

## Monorepo layout

```
collabmd/
├── apps/web/                  # Next.js 15 (App Router) web editor
├── apps/sync-server/          # Yjs WebSocket sync server
├── packages/shared/           # Shared types, config, design tokens
├── packages/db/               # Drizzle ORM schema + migrations (SQLite dev, Postgres prod)
├── packages/collabmd/         # CLI + local daemon
├── packages/create-collabmd/  # Project scaffolder (npx create-collabmd)
├── packages/mcp-server/       # MCP server for agent access without filesystem
├── .env.example               # All env vars documented
├── docker-compose.yml         # Self-hosted deployment
└── turbo.json                 # Build pipeline
```

## First-time setup

```bash
git clone https://github.com/collabmd/collabmd.git
cd collabmd
pnpm install
cp .env.example apps/web/.env.local
```

Edit `apps/web/.env.local`:
- Set `BETTER_AUTH_SECRET` to any random 32+ char string
- Leave everything else as defaults for local dev

Start everything:
```bash
pnpm dev
```

This launches the web app on `http://localhost:3000` and the sync server on `ws://localhost:4444`.

## Key commands

| Command | What it does |
|---------|-------------|
| `pnpm dev` | Start web app + sync server |
| `pnpm build` | Build all packages |
| `pnpm test` | Run all tests (vitest) |
| `pnpm typecheck` | Type-check all packages |
| `pnpm lint` | Lint all packages |
| `pnpm format` | Format with Prettier |
| `pnpm format:check` | Check formatting without writing |

## Tech stack

- TypeScript everywhere, strict mode
- Next.js 15 (App Router) for the web app
- CodeMirror 6 for the editor
- Yjs for CRDTs, y-websocket for sync
- Better Auth for identity (magic link + OAuth)
- OpenFGA for per-document permissions
- Drizzle ORM with SQLite (local dev) or Postgres (prod)
- Tailwind CSS v4

## Important conventions

**Drizzle imports:** Always import operators (eq, and, isNull, etc.) from `@collabmd/db`, never directly from `drizzle-orm`. pnpm hoisting causes dual-instance type conflicts otherwise.

**API routes:** Live in `apps/web/src/app/api/`. Every route has a co-located `.test.ts` file. Auth pattern:
```typescript
const session = await auth.api.getSession({ headers: await headers() })
if (!session) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
```

**Agent API:** v1 REST endpoints at `/api/v1/documents/:id/{content,comments,discussions}` authenticate via `Authorization: Bearer ak_...` agent keys. Auth middleware: `apps/web/src/lib/agent-key-auth.ts`.

**Design system:** Warm copper accent `#c2682b`, neutral backgrounds `#f7f7f5`. Tokens in `packages/shared/src/design-system.ts`. Reference in `DESIGN_SYSTEM.md`.

**Tailwind v4 gotchas:** `--radius-default` maps to `rounded` (not `rounded-default`). `--shadow-default` maps to `shadow` (not `shadow-default`).

**Fonts:** JetBrains Mono (mono) + Plus Jakarta Sans (sans), self-hosted in `apps/web/src/app/fonts/`. Uses `next/font/local`, not `next/font/google`.

**DB migrations:** After editing `packages/db/src/schema.ts`, generate with `pnpm --filter @collabmd/db db:generate`.

**tsup builds:** CLI packages use `--external readline` for Node.js builtins. `incremental: true` in tsconfig breaks DTS builds.

**Better Auth CSRF:** `BETTER_AUTH_URL` in `.env.local` must match the actual server port, otherwise all POST requests get 403.

## CRDT architecture

Each document has a Yjs Y.Doc containing:
- `Y.Text('codemirror')` — the document content
- `Y.Array('comments')` — inline comments (each is a Y.Map with anchor, text, thread, optional suggestion)
- `Y.Array('discussions')` — document-level discussion threads

The sync server manages Y.Docs in memory and persists via the database. The local daemon syncs `.md` files to/from the CRDT using fast-diff.

## Local daemon

The daemon (`packages/collabmd/`) watches a folder for `.md` file changes and syncs them via WebSocket. Key files:

- `src/daemon/index.ts` — FolderDaemon (per-folder) + Daemon orchestrator
- `src/daemon/crdt-bridge.ts` — file ↔ CRDT sync via fast-diff
- `src/daemon/comment-bridge.ts` — comments ↔ `.collabmd/comments/*.comments.json`
- `src/daemon/discussion-bridge.ts` — discussions ↔ `.collabmd/discussions/*.discussions.json`
- `src/daemon/git-sync.ts` — idle-batched auto-commits
- `src/daemon/sync-client.ts` — WebSocket client with reconnection

## Comments and suggestions (for agents)

Comments live in sidecar JSON files, not inline in the `.md`:

```
.collabmd/comments/docs/readme.md.comments.json
```

Each comment has: id, line range, author, text, thread (replies), resolved status, and optional suggestion (originalText, proposedText, status).

To add a comment as an agent, append to the JSON array. The daemon syncs it to the CRDT automatically.

To propose a suggestion, add a comment with a `suggestion` object:
```json
{
  "id": "uuid",
  "anchor": { "startLine": 5, "endLine": 5 },
  "author": { "name": "Agent" },
  "text": "Consider rewording this section",
  "suggestion": {
    "originalText": "the old text",
    "proposedText": "the new text",
    "status": "pending"
  }
}
```

The human can accept or dismiss the suggestion from the web UI.

## Webhook events

The sync server emits webhooks on document events: `document.edited`, `comment.created`, `comment.mention`, `suggestion.created`, `suggestion.accepted`, `suggestion.dismissed`, `discussion.created`. Webhooks are configured per-org in org settings.

## Permissions model

OpenFGA-based. Roles: owner > admin > member. Document permissions: editor > commenter > viewer. Folder permissions cascade to contained documents. Agent API keys inherit the permissions of the user who created them, optionally scoped to specific documents or folders.
