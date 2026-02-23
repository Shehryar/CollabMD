# Getting Started with CollabMD

CollabMD is a collaborative markdown editor where local `.md` files, a web editor, and AI agents all stay in sync via CRDTs. You can use it entirely from the browser, entirely from your terminal, or both at the same time.

## Choose your path

### Browser-first (no terminal needed)

1. Open `http://localhost:3000` (or your hosted instance)
2. Sign up with email (magic link) or OAuth (Google/GitHub)
3. Create or join an organization
4. Start writing. Documents autosave and sync in real time

That's it. You get a markdown editor with live preview, inline comments, version history, and sharing.

### Local-first (terminal + your editor)

This path syncs a folder of `.md` files on your machine to the web editor, so teammates in the browser see your edits live and vice versa.

**1. Set up the server (if self-hosting)**

```bash
git clone https://github.com/collabmd/collabmd.git
cd collabmd
pnpm install
cp .env.example apps/web/.env.local
# edit apps/web/.env.local — at minimum set BETTER_AUTH_SECRET to a random string
pnpm dev
```

Web app at `http://localhost:3000`, sync server at `ws://localhost:4444`.

Or use Docker:

```bash
docker compose up
```

**2. Sign up and create an org**

Open `http://localhost:3000`, sign up, and create an organization. You'll need the org for the CLI to connect to.

**3. Scaffold a project**

```bash
npx create-collabmd my-docs
cd my-docs
```

This creates `collabmd.json` (config), `COLLABMD.md` (agent discovery), a `docs/` folder with a welcome doc, and a `.collabmd/` directory for local state.

The interactive wizard walks you through: choosing local or server mode, authenticating, selecting an org, and linking the folder.

**4. Start the daemon**

```bash
npx collabmd dev
```

The daemon watches your folder for `.md` file changes, syncs them to the server via WebSocket, and writes remote changes back to disk. Edit files in VS Code, Vim, or any editor. Changes appear in the browser instantly.

**5. (Optional) Background daemon**

For always-on sync across multiple folders:

```bash
npx collabmd service install   # macOS LaunchAgent or Linux systemd
npx collabmd service start
npx collabmd link               # register current folder
```

## CLI reference

| Command | What it does |
|---------|-------------|
| `collabmd dev` | Start foreground daemon for current folder |
| `collabmd init` | Run onboarding in the current directory |
| `collabmd login` | Authenticate with CollabMD server |
| `collabmd logout` | Clear saved credentials |
| `collabmd link [url]` | Connect folder to a server |
| `collabmd unlink` | Disconnect folder from daemon |
| `collabmd push` | Push local git commits to remote |
| `collabmd pull` | Fetch and merge remote changes |
| `collabmd status` | Show daemon status |
| `collabmd service install/start/stop/restart/status/uninstall` | Manage background daemon |

## Git integration

CollabMD auto-commits your markdown changes to git on an idle timer. Configure in `collabmd.json`:

```json
{
  "git": {
    "autoCommit": true,
    "idleTimeout": 30000,
    "commitMessage": "docs: update {files}"
  }
}
```

Push and pull with conflict detection:

```bash
collabmd push
collabmd pull
```

If there are merge conflicts, they're written to `.collabmd/conflicts.json` and surfaced in the web editor with accept/reject controls.

## Comments and suggestions

CollabMD supports inline comments that sync between the web editor and local files.

**In the browser:** select text, click the comment button, type your comment. Comments appear as margin annotations. You can also suggest edits (proposes a text change the author can accept or dismiss).

**Locally:** comments are stored in `.collabmd/comments/<filepath>.comments.json`. Agents and local users can read and write these files directly. New comments sync to the web editor automatically.

## Sharing

- **By email:** invite specific people with editor/commenter/viewer permissions
- **By link:** generate a shareable URL with configurable access level
- **Folder permissions:** set access on a folder, all docs inside inherit

## Environment variables

See [.env.example](../.env.example) for the full list. The essentials:

| Variable | Required | Description |
|----------|----------|-------------|
| `BETTER_AUTH_SECRET` | Yes | Random 32-char string for session signing |
| `BETTER_AUTH_URL` | Yes | Public URL of the web app |
| `NEXT_PUBLIC_SYNC_URL` | Yes | WebSocket URL for the sync server |

Everything else has sensible defaults for local development.
