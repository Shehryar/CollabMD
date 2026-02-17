# Contributing to CollabMD

## Development Setup

1. Fork and clone the repository:

   ```bash
   git clone https://github.com/<your-username>/collabmd.git
   cd collabmd
   ```

2. Install dependencies:

   ```bash
   pnpm install
   ```

3. Copy the environment file and fill in values:

   ```bash
   cp .env.example apps/web/.env.local
   ```

4. Start the dev servers:

   ```bash
   pnpm dev
   ```

   This starts the Next.js web app on `http://localhost:3000` and the sync server on `ws://localhost:4444`.

## Project Structure

```
collabmd/
├── apps/
│   ├── web/                 # Next.js 15 web editor
│   └── sync-server/         # Yjs WebSocket sync server
├── packages/
│   ├── shared/              # Shared types, config, design system
│   ├── db/                  # Drizzle ORM schema & migrations
│   ├── collabmd/            # CLI + local daemon
│   └── create-collabmd/     # Project scaffolder
```

## Available Commands

Run from the repository root:

| Command | Description |
|---------|-------------|
| `pnpm dev` | Start all dev servers |
| `pnpm build` | Build all packages and apps |
| `pnpm test` | Run tests across the monorepo |
| `pnpm lint` | Lint all packages |
| `pnpm typecheck` | Type-check all packages |
| `pnpm format` | Format code with Prettier |

## Pull Request Guidelines

1. Branch from `main`.
2. Write tests for new functionality.
3. Run `pnpm typecheck` and `pnpm lint` before submitting.
4. Keep PRs focused — one feature or fix per PR.
5. Write a clear description of what changed and why.

## Code Style

- TypeScript with strict mode enabled.
- 2-space indentation.
- Tailwind CSS for styling (no custom CSS unless necessary).
- Prefer named exports.
- Use Drizzle ORM for all database access.
