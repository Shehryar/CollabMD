# CollabMD

Collaborative markdown editing. Local files, web editor, and AI agents, all synced via CRDTs.

**Live at [collabmd.dev](https://collabmd.dev)**

## Features

- **Real-time CRDT sync** -- conflict-free collaboration powered by Yjs
- **Local-first daemon** -- edit `.md` files in your favorite editor, changes sync automatically
- **Inline comments & suggestions** -- comment threads and suggest-then-accept editing mode (Google Docs style)
- **AI agent platform** -- @mention agents in comments, MCP server, webhook integrations, agent API keys
- **Version history** -- automatic snapshots, browse and revert to any previous state
- **Fine-grained permissions** -- per-document/folder access control via OpenFGA (owner, editor, commenter, viewer)
- **Sharing** -- invite by email, share links with optional password/expiry, pending invites for non-users
- **Git auto-commit** -- idle-batched commits, push/pull with merge conflict detection
- **Full-text search** -- instant document search across your workspace
- **Multiple themes** -- Light, Dark, Midnight, Dracula
- **Self-hosted** -- run the entire stack on your own infrastructure

## Quick Start

### Prerequisites

- Node.js 22+
- pnpm 10+

### Setup

```bash
git clone https://github.com/Shehryar/CollabMD.git
cd CollabMD
pnpm install
cp .env.example apps/web/.env.local
pnpm dev
```

Wait for the "OpenFGA auth model written" log, then open `http://localhost:3000`.

## Docker

```bash
docker compose up
```

For production deployment, see the deploy workflow in [CLAUDE.md](./CLAUDE.md).

## Architecture

```
collabmd/
├── apps/
│   ├── web/                 # Next.js 15 web editor
│   └── sync-server/         # Yjs WebSocket sync server
├── packages/
│   ├── shared/              # Shared types, config, design system, OpenFGA client
│   ├── db/                  # Drizzle ORM schema & migrations (SQLite + Postgres)
│   ├── collabmd/            # CLI + local daemon
│   ├── create-collabmd/     # Project scaffolder (npx create-collabmd)
│   └── mcp-server/          # MCP server for AI agent access
├── scripts/
│   ├── dev.ts               # Dev orchestrator (builds, OpenFGA, watchers)
│   ├── rebuild-fga-tuples.ts # Permission recovery script
│   └── queue.ts             # Autonomous ticket runner
└── e2e/                     # Playwright end-to-end tests
```

## Stack

| Layer         | Technology                     |
| ------------- | ------------------------------ |
| Language      | TypeScript (strict)            |
| Web framework | Next.js 15 (App Router)        |
| Editor        | CodeMirror 6                   |
| CRDT          | Yjs                            |
| Auth          | Better Auth                    |
| Permissions   | OpenFGA                        |
| ORM           | Drizzle                        |
| Database      | SQLite (dev) / Postgres (prod) |
| Styling       | Tailwind CSS v4                |
| Email         | Loops (transactional)          |

## Environment Variables

Key variables (see [.env.example](./.env.example) for the full list):

| Variable               | Description                               | Required |
| ---------------------- | ----------------------------------------- | -------- |
| `BETTER_AUTH_SECRET`   | Random 32-char secret for session signing | Yes      |
| `BETTER_AUTH_URL`      | Public URL of the web app                 | Yes      |
| `NEXT_PUBLIC_SYNC_URL` | WebSocket URL for the sync server         | Yes      |
| `DATABASE_URL`         | Postgres connection string (prod)         | No       |
| `OPENFGA_URL`          | OpenFGA server URL                        | No       |
| `LOOPS_API_KEY`        | Loops API key for transactional email     | No       |

## Agent Integration

CollabMD has a built-in agent platform. AI agents can read/write documents, leave comments, suggest edits, and participate in discussions.

- **MCP server**: `collabmd mcp --api-key ak_... --base-url https://collabmd.dev`
- **REST API**: `/api/v1/documents`, `/api/v1/documents/:id/content`, etc.
- **Webhooks**: real-time event delivery for document edits, comments, mentions
- **@mentions**: tag agents in comments to trigger automated responses

See [AGENT_SETUP.md](./AGENT_SETUP.md) for setup instructions.

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md) for development setup, project structure, and PR guidelines.

## License

[MIT](./LICENSE)
