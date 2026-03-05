# CollabMD

Collaborative markdown editing — local files, web editor, and AI agents, all synced via CRDTs.

## Features

- **Real-time CRDT sync** — conflict-free collaboration powered by Yjs
- **Local-first daemon** — edit `.md` files in your favorite editor, changes sync automatically
- **Inline comments & suggestions** — comment threads and AI-powered suggestions with accept/dismiss
- **Version history** — snapshot and restore any previous document state
- **Fine-grained permissions** — per-document access control via OpenFGA
- **Git auto-commit & push/pull** — idle-batched commits, push/pull with merge conflict detection
- **Self-hosted** — run the entire stack on your own infrastructure

## Quick Start

### Prerequisites

- Node.js 22+
- pnpm 9+

### Setup

```bash
git clone https://github.com/collabmd/collabmd.git
cd collabmd
pnpm install
cp .env.example apps/web/.env.local
pnpm dev
```

The web app runs at `http://localhost:3000` and the sync server at `ws://localhost:4444`.

## Docker

```bash
docker compose up
```

See [docker-compose.yml](./docker-compose.yml) for configuration options.

## Architecture

```
collabmd/
├── apps/
│   ├── web/                 # Next.js 15 web editor
│   └── sync-server/         # Yjs WebSocket sync server
├── packages/
│   ├── shared/              # Shared types, config, design system
│   ├── db/                  # Drizzle ORM schema & migrations
│   ├── collabmd/            # CLI + local daemon
│   └── create-collabmd/     # Project scaffolder (npx create-collabmd)
├── .env.example
├── turbo.json
└── pnpm-workspace.yaml
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

## Environment Variables

Key variables (see [.env.example](./.env.example) for the full list):

| Variable               | Description                               | Required |
| ---------------------- | ----------------------------------------- | -------- |
| `BETTER_AUTH_SECRET`   | Random 32-char secret for session signing | Yes      |
| `BETTER_AUTH_URL`      | Public URL of the web app                 | Yes      |
| `NEXT_PUBLIC_SYNC_URL` | WebSocket URL for the sync server         | Yes      |
| `DATABASE_URL`         | Postgres connection string (prod)         | No       |
| `OPENFGA_URL`          | OpenFGA server URL                        | No       |
| `RESEND_API_KEY`       | Resend API key for transactional email    | No       |

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md) for development setup, project structure, and PR guidelines.

## License

[MIT](./LICENSE)
