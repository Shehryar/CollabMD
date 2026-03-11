# Agent Collaboration Test Flow

This walkthrough covers ticket `T-137` and validates:

- MCP server boot and tool calls
- org agent API keys
- `/api/v1/documents/*` REST endpoints
- comment, suggestion, and discussion CRDT sync
- `@mention` trigger dispatch from the local daemon
- agent presence in the web editor

## Prerequisites

Start the full local stack first:

```bash
pnpm install
cp .env.example apps/web/.env.local
pnpm dev
```

Use a second terminal for the test flow. Authenticate the CLI once so the script can call the authenticated app APIs:

```bash
pnpm exec collabmd login --server http://localhost:3000
```

## Automated flow for steps 1-4

Run:

```bash
./scripts/test-agent-collab.sh
```

The script does the following:

1. Resolves your first accessible org, or creates one if your account has none.
2. Creates an org agent API key through `POST /api/orgs/:orgId/agent-keys`.
3. Creates a starter document through `POST /api/documents`.
4. Seeds the document content through `PATCH /api/v1/documents/:id/content`.
5. Starts the MCP server with the new API key.
6. Uses a scripted MCP client to:
   - list documents
   - read the test document
   - add an anchored comment
   - suggest an edit
   - add a discussion
   - list comments and discussions again for verification

The final JSON summary includes:

- the org id
- the raw `ak_...` agent key
- the test document URL
- a ready-to-paste Claude Code MCP command
- the tool names exposed by the MCP server
- comment, suggestion, and discussion counts after the scripted run

## Manual Claude Code session

If you want to repeat step 4 in a real Claude Code session, add the generated command to `.claude/settings.json`.

Example:

```json
{
  "mcpServers": {
    "collabmd": {
      "command": "pnpm",
      "args": [
        "exec",
        "collabmd",
        "mcp",
        "--api-key",
        "ak_...",
        "--base-url",
        "http://localhost:3000"
      ]
    }
  }
}
```

Prompt Claude Code with something like:

```text
Use the CollabMD MCP tools to list documents, read the agent collaboration test document, add one comment, suggest one edit, and add one discussion thread.
```

## Web UI verification for step 5

Open the document URL printed by the script in the browser.

Confirm all of the following in real time:

- the agent comment appears on the anchored text
- the pending suggestion appears with original and proposed text
- the discussion thread appears in the discussion panel

Then accept or dismiss the suggestion in the web UI and confirm the state updates immediately.

## `@mention` dispatch and agent presence for step 6

This part validates the local daemon trigger flow. Use any linked local CollabMD folder in the same org. If you do not already have one, create a disposable folder, put a markdown file in it, then link it with the CLI:

```bash
mkdir -p /tmp/collabmd-agent-collab-fixture
cd /tmp/collabmd-agent-collab-fixture
mkdir -p docs
printf '# Mention Test\n\nThis file is used for daemon @mention testing.\n' > docs/mention-test.md
collabmd init --server http://localhost:3000 --org <org-id> --skip=background
collabmd agent add writer --command "cat | node -e \"let raw='';process.stdin.on('data',c=>raw+=c);process.stdin.on('end',()=>{const payload=JSON.parse(raw);process.stdout.write(JSON.stringify({replyText:'writer saw '+payload.commentId,author:'writer'}));});\""
collabmd dev
```

With the daemon running:

1. Open the synced `Mention Test` document from that folder in the web UI.
2. Confirm the document header shows a robot-badged presence avatar while `collabmd dev` is connected.
3. Add a web comment that mentions `@writer`.
4. Verify a trigger file appears under `.collabmd/agent-triggers/...`.
5. Verify the configured command writes a matching `.response.json`.
6. Confirm the response is added back into the comment thread in the web UI.

Files to inspect during the mention test:

- `.collabmd/comments/...`
- `.collabmd/agent-triggers/.../*.json`
- `.collabmd/agent-triggers/.../*.response.json`

## Expected result

The ticket is validated when:

- the script completes successfully
- the web UI shows the agent-created comment, suggestion, and discussion on the test document
- accepting or dismissing the suggestion updates the synced state
- a `@writer` mention creates a trigger file, the daemon executes the configured command, and the agent reply lands back in the thread
- the linked daemon session shows up as agent presence in the document header
