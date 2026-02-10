# CollabMD Project Context

## What is CollabMD
Collaborative markdown editor: local .md files + web editor + AI agents, all synced via CRDTs. Monorepo at ~/Documents/Dev/CollabMD (pnpm + Turborepo).

Progress tracked in ~/Documents/Notes/AI/Projects/Local-First-Collab-Docs/Progress.md — read this first for full ticket details and status.

## Stack
TypeScript everywhere, Next.js 15 (App Router), CodeMirror 6, Yjs, Tailwind CSS v4, Better Auth (identity/orgs), OpenFGA (per-doc permissions), SQLite for local dev (better-sqlite3), Drizzle ORM.

## Monorepo Structure
- `apps/web` — Next.js web app (port 3000)
- `apps/sync-server` — y-websocket sync server (port 4444)
- `packages/db` — Drizzle schema + SQLite client
- `packages/shared` — types, config, OpenFGA model + helpers
- `packages/collabmd` — CLI + daemon
- `packages/create-collabmd` — scaffolder

## Current State
- **Phase 0 COMPLETE** (T-001–T-008): monorepo scaffold, Drizzle schema, config system, CLI skeleton, OpenFGA spike, Vitest + CI
- **Phase 1 COMPLETE** (T-010–T-015): CodeMirror 6 editor, Yjs integration, y-websocket sync server, inline live preview, formatting toolbar
- **Phase 2 COMPLETE** (T-020–T-02B): auth, orgs, permissions, sharing, rate limiting, deletion
- **Phase 3 COMPLETE** (T-030–T-032): sidebar navigation, folder management UI, doc list with search/sort/drag-and-drop

## Key Files by Area

### Database
- `packages/db/src/schema.ts` — all tables: users, sessions, accounts, orgs, members, invitations, jwks, folders, documents, documentSnapshots, shareLinks
- `packages/db/src/client.ts` — Drizzle instance (better-sqlite3, WAL mode)
- `packages/db/src/index.ts` — re-exports schema + db + drizzle operators (eq, and, isNull, inArray, desc, like, ne, etc.)

### Auth
- `apps/web/src/lib/auth.ts` — Better Auth server config (Drizzle adapter, magic link, OAuth, JWT, org plugin, auto-create personal org on signup)
- `apps/web/src/lib/auth-client.ts` — React client with org/magicLink/jwt plugins, exports useSession/signIn/signOut/useActiveOrganization/useListOrganizations
- `apps/web/src/app/api/auth/[...all]/route.ts` — Better Auth API handler
- `apps/web/middleware.ts` — edge cookie check, protects /doc/*, /org/*, /trash
- `apps/sync-server/src/auth.ts` — jose JWKS verification for WebSocket JWT auth

### Permissions (OpenFGA)
- `packages/shared/src/fga/model.json` — OpenFGA auth model (user, org, folder, document types with inheritance)
- `packages/shared/src/fga/client.ts` — helpers: checkPermission, writeTuple, deleteTuple, readTuples, listAccessibleObjects, writeAuthModel
- `packages/shared/src/fga/index.ts` — re-exports all helpers
- Permission hierarchy: owner > editor > commenter > viewer, folder→doc inheritance via parent tuples

### Document CRUD + Sharing
- `apps/web/src/app/api/documents/route.ts` — POST (create with FGA owner + org + folder parent tuples + org defaults) and GET (list via FGA listObjects, supports ?folderId=, ?shared=true, ?search= query params)
- `apps/web/src/app/api/documents/[id]/route.ts` — GET/PATCH/DELETE (with FGA permission checks; PATCH supports folderId update with FGA parent tuple management)
- `apps/web/src/app/api/documents/[id]/share/route.ts` — POST/GET/DELETE (email sharing via FGA tuples)
- `apps/web/src/app/api/documents/[id]/share-links/route.ts` — POST/GET share links (password + expiry)
- `apps/web/src/app/api/documents/[id]/share-links/[linkId]/route.ts` — DELETE revoke
- `apps/web/src/app/api/share/[token]/route.ts` — POST validate share link (anonymous, rate limited)
- `apps/web/src/app/share/[token]/page.tsx` — share access page (password form, redirect)
- `apps/web/src/components/share-modal.tsx` — share by email + collaborators + share links UI

### Folders + Org Settings
- `apps/web/src/app/api/folders/route.ts` — POST/GET folder CRUD
- `apps/web/src/app/api/folders/[id]/route.ts` — PATCH/DELETE (empty check, FGA cleanup)
- `apps/web/src/app/api/folders/[id]/permissions/route.ts` — POST/GET/DELETE folder permissions
- `apps/web/src/app/api/orgs/[orgId]/settings/route.ts` — GET/PATCH org default doc permission (stored in metadata JSON)

### Deletion Lifecycle
- `apps/web/src/app/api/documents/trash/route.ts` — GET soft-deleted docs
- `apps/web/src/app/api/documents/[id]/restore/route.ts` — POST restore within 30 days
- `apps/web/src/app/api/documents/[id]/permanent/route.ts` — DELETE hard delete
- `apps/web/src/lib/hard-delete.ts` — reusable cleanup utility (DB rows + FGA tuples)
- Trash view UI now at `apps/web/src/app/(app)/trash/page.tsx`

### Rate Limiting
- `apps/web/src/lib/rate-limit.ts` — in-memory token bucket (100/min mutations, 30/min anonymous)
- WebSocket: 20 connections/user limit in `apps/sync-server/src/server.ts`

### Editor
- `apps/web/src/components/editor/editor.tsx` — CodeMirror 6 + Yjs + preview plugin + toolbar
- `apps/web/src/components/editor/formatting-commands.ts` — wrap/toggle/prefix helpers + keymap
- `apps/web/src/components/editor/markdown-preview.ts` — ViewPlugin decorations (Obsidian-style)
- `apps/web/src/components/editor/formatting-toolbar.tsx` — React toolbar
- `apps/web/src/components/editor/use-yjs.ts` — Y.Doc + WebSocketProvider hook

### Pages (route groups)
Pages use Next.js route groups for layout separation: `(app)/` gets the sidebar layout, `(auth)/` gets a minimal layout. Share and org pages stay at root level.

- `apps/web/src/app/(app)/page.tsx` — home page / doc list (search, sort, folder filter, breadcrumbs, drag-and-drop, "Move to..." dropdown)
- `apps/web/src/app/(app)/doc/[id]/page.tsx` — editor page (editable title, share button, sync status; nav handled by sidebar)
- `apps/web/src/app/(app)/trash/page.tsx` — trash view (restore, permanent delete)
- `apps/web/src/app/(app)/layout.tsx` — sidebar layout (SidebarProvider + DndContext + DragOverlay + Sidebar + main)
- `apps/web/src/app/(auth)/login/page.tsx` + `signup/page.tsx` — auth pages (no sidebar)
- `apps/web/src/app/org/[slug]/settings/page.tsx` — org settings (members, invites, doc defaults)
- `apps/web/src/app/org/new/page.tsx` — create org
- `apps/web/src/app/share/[token]/page.tsx` — anonymous share link access

### Sidebar (`components/sidebar/`)
- `sidebar-context.tsx` — React context: folders list, docs list, sidebar open/closed, refresh functions. Fetches on org change via `useActiveOrganization`
- `sidebar.tsx` — shell: logo, new-doc button, nav links (All Documents, Shared with me, Trash), FolderTree, OrgSwitcher, user email, sign out. Mobile overlay with backdrop
- `folder-tree.tsx` — recursive folder tree with `useDroppable` (drag targets), expand/collapse, inline create/rename, context menu (rename/new subfolder/delete)

## Key Patterns & Gotchas
- Drizzle operators (eq, and, etc.) MUST be imported from `@collabmd/db`, NOT `drizzle-orm` directly — avoids pnpm dual-instance type conflicts
- `better-sqlite3` needs `serverExternalPackages` in next.config.ts + direct dependency in web app
- Auth session in API routes: `await auth.api.getSession({ headers: await headers() })`
- Dynamic route params in Next.js 15: `{ params: Promise<{ id: string }> }` (must await)
- FGA tuple format: user = `'user:abc'`, object = `'document:xyz'` or `'folder:xyz'`
- Org metadata column (text JSON) stores settings like `defaultDocPermission`
- Better Auth `autoCreateOrganizationOnSignUp` was removed; using `databaseHooks.user.create.after`
- Node `server.close()` waits for keep-alive connections; track sockets and destroy() for clean shutdown
- Node Buffer.buffer returns the pool ArrayBuffer — use `new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength)`

### Drag-and-Drop
- `@dnd-kit/core` + `@dnd-kit/sortable` + `@dnd-kit/utilities` in `apps/web/package.json`
- `DndContext` wraps sidebar (drop targets) + main content (draggable items) in `(app)/layout.tsx`
- Doc rows use `useDraggable`, folder tree nodes use `useDroppable`
- `DragOverlay` shows a floating pill with doc title during drag
- "Move to..." dropdown on each doc row as keyboard-accessible alternative

## Commands
- `pnpm build` — build all 6 packages
- `pnpm test` — run all tests (101 passing across 8 files)
- `pnpm lint` — ESLint across all packages
- `pnpm dev` — start dev servers
- Build needs `BETTER_AUTH_SECRET` env var: `BETTER_AUTH_SECRET=dev-secret pnpm build`

## What Comes Next
Phase 4: Sidecar Daemon (T-040–T-047) — `collabmd dev` gains real sync. Local .md files sync bidirectionally with the server via file watcher + file-to-CRDT bridge. This is the novel piece of the project. Read Progress.md for full ticket specs.
