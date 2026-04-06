# Agent Mention Dispatch

When a user @mentions an agent in a CollabMD comment, the agent needs to receive that mention, read the document context, and respond. This spec covers how that works across different user setups: local daemon users, Claude Code users with the MCP server, and users who bring their own agent runtime.

## Problem

Today the sync server detects `comment.mention` events and fires outbound webhooks. But that requires the agent to be reachable at a public URL. Most users running local agents (Claude Code, OpenClaw, etc.) don't have a public endpoint. The daemon's `AgentRunner` handles local mentions via file-system triggers, but only for documents synced locally via CRDT, not for cloud-only documents.

There's no path for a local agent to pick up @mentions from cloud documents.

## Priority Order

1. MCP tool gap fill (`collabmd_reply_to_comment`)
2. Daemon polling loop
3. MCP server mention notifications
4. ACP support in daemon
5. Remote trigger integration (docs only)

## Personas

**Local daemon user:** Has `collabmd daemon` running. Wants configured agents (Claude Code, OpenClaw, custom scripts) to automatically respond to @mentions on any document in their org, including cloud-only docs they don't have synced locally.

**Claude Code user (no daemon):** Has Claude Code open with the CollabMD MCP server connected. Wants to manually or semi-automatically check for and respond to mentions.

**Webhook user:** Has a hosted agent server. Already works today via outbound webhooks. No changes needed.

**Cloud user with API key (future):** Wants to paste in a Claude/OpenAI API key and have CollabMD run agents server-side. Out of scope for this spec.

## Section 1: `collabmd_reply_to_comment` MCP Tool

### What

Add a new MCP tool that lets an agent reply to a specific comment thread.

### Why

The MCP server has `collabmd_add_comment` (creates a new anchored comment) and `collabmd_get_pending_mentions` (finds mentions). But there's no way to reply to the comment that contains the mention. The v1 API already supports replies (`POST /api/v1/documents/:id/comments` with `{ commentId, text }`), so the MCP server just needs to expose it.

### Tool Definition

```typescript
{
  name: 'collabmd_reply_to_comment',
  description: 'Reply to an existing comment thread. Use this to respond to @mentions.',
  inputSchema: {
    type: 'object',
    properties: {
      documentId: { type: 'string', description: 'The document ID.' },
      commentId: { type: 'string', description: 'The comment ID to reply to.' },
      text: { type: 'string', description: 'Reply text.' },
    },
    required: ['documentId', 'commentId', 'text'],
  },
}
```

### Implementation

The tool calls `POST /api/v1/documents/:id/comments` with `{ commentId, text }`. This is a thin wrapper around an existing API endpoint. The `api-client.ts` in the MCP server package needs a new `replyToComment(documentId, commentId, text)` method.

### End-to-End Flow (Manual)

1. User has Claude Code open with CollabMD MCP server configured
2. User says: "Check collabmd for any pending mentions and respond"
3. Claude Code calls `collabmd_get_pending_mentions`
4. Sees a mention: `{ documentId: "abc", commentId: "xyz", text: "@reviewer fix the intro" }`
5. Calls `collabmd_read_document` to get doc content
6. Calls `collabmd_list_comments` to get full thread context
7. Reasons about the request
8. Calls `collabmd_reply_to_comment` with the response
9. Response appears in the comment thread for all connected users via CRDT sync

## Section 2: Daemon Polling Loop

### What

The daemon periodically checks `/api/v1/mentions/pending` for new @mentions addressed to configured agents, then spawns the appropriate command to handle each one.

### Why

The daemon already has `AgentRunner` that spawns shell commands from trigger files. Today triggers only come from the local file watcher (comment-bridge detecting @mentions in locally synced docs). For cloud-only documents, the daemon needs a second trigger source: polling the API.

### Configuration

New fields in `collabmd.json`:

```json
{
  "agents": {
    "enabled": true,
    "apiKey": "ak_...",
    "serverUrl": "https://collabmd.dev",
    "pollInterval": 10,
    "commands": {
      "reviewer": { "command": "claude --print ..." },
      "writer": { "command": "openclaw exec ..." }
    }
  }
}
```

- `apiKey`: Agent API key created in org settings. Required for polling.
- `serverUrl`: CollabMD server URL. Defaults to `https://collabmd.dev`.
- `pollInterval`: Seconds between polls. Defaults to 10. Minimum 5.
- `commands`: Same format as today. Key is the agent name that matches the @mention.

### Polling Loop

New class: `MentionPoller` in `packages/collabmd/src/daemon/mention-poller.ts`.

- Runs on a `setInterval` at the configured `pollInterval`
- Calls `GET /api/v1/mentions/pending` with the agent API key as bearer token
- For each pending mention:
  - Checks if the `mentionedAgent` matches a configured command
  - Checks if this mention has already been dispatched (tracked by `commentId` in a `Set`)
  - Writes a trigger file to `.collabmd/agent-triggers/` in the same format comment-bridge uses
  - Calls `AgentRunner.handleTriggerCreated()` with the trigger path
- After the agent responds, the response is posted back via `POST /api/v1/documents/:id/comments` with `{ commentId, text }` using the same API key

### Deduplication

The poller tracks dispatched mention IDs in memory (`Set<string>`). A mention is considered "handled" once the trigger file is created. If the daemon restarts, it may re-process mentions that were handled but not yet replied to. This is acceptable for the MVP since `AgentRunner` already deduplicates by trigger path.

The `/api/v1/mentions/pending` endpoint already filters out mentions that have a reply from the agent, so once the agent responds, the mention drops off the list naturally.

### Integration with FolderDaemon

`MentionPoller` is instantiated in `FolderDaemon` alongside the existing `AgentRunner`. It shares the same `AgentRunner` instance for command execution. The poller starts when the daemon starts and stops when the daemon stops.

For the multi-folder `Daemon` orchestrator: the poller runs once globally (not per folder), since mentions are org-scoped, not folder-scoped.

### Response Posting

Today `AgentRunner` writes a `.response.json` file that comment-bridge picks up and syncs back into the CRDT. For cloud mentions, there's no local CRDT to sync into. Instead, the poller posts the response directly via the v1 API after the agent command completes.

The response flow branches:
- **Local trigger (file watcher):** response → `.response.json` → comment-bridge → CRDT
- **Cloud trigger (poller):** response → v1 API POST → sync server → CRDT

### Error Handling

- API unreachable: log warning, retry on next poll interval
- Agent command fails: log error, mark mention as dispatched (don't retry automatically)
- Agent command times out: same as today, `AgentRunner` kills the process after the configured timeout

## Section 3: MCP Server Mention Notifications

### What

The MCP server proactively notifies connected Claude Code sessions when new @mentions arrive, instead of waiting for the user to manually call `collabmd_get_pending_mentions`.

### Why

The manual flow (Section 1) works but requires the user to remember to check. With notifications, Claude Code surfaces a nudge like "You have a pending mention in Document X" without the user asking.

### How

The MCP server adds a background polling loop (reusing the same `/api/v1/mentions/pending` endpoint):

- On startup, the MCP server begins polling at a configurable interval (default 30 seconds)
- When new mentions are detected (compared to previous poll), it sends an MCP `notifications/resources/updated` notification for the affected document resources
- Claude Code receives the notification and can surface it to the user

### Configuration

New CLI flags for the MCP server:

```
collabmd-mcp --base-url https://collabmd.dev --api-key ak_... --notify-mentions --poll-interval 30
```

- `--notify-mentions`: Enable mention polling and notifications. Off by default.
- `--poll-interval`: Seconds between polls. Defaults to 30.

### Limitations

- Claude Code doesn't auto-act on MCP notifications. The user still decides whether to respond.
- This is a UX improvement, not automation. The daemon polling loop (Section 2) handles automation.
- If both the daemon and MCP server are running, the daemon handles execution while the MCP server provides visibility.

## Section 4: ACP Support in Daemon

### What

The daemon can spawn ACP-compatible agents instead of raw shell commands, using the Agent Client Protocol for structured communication.

### Why

Raw shell commands work but require per-agent configuration of stdin/stdout JSON formats. ACP standardizes this: any ACP-compatible agent (OpenClaw, Claude Code when supported, custom agents) works without custom integration.

### Configuration

New `acp` field in agent command config, mutually exclusive with `command`:

```json
{
  "agents": {
    "commands": {
      "reviewer": { "command": "claude --print ..." },
      "designer": { "acp": "openclaw acp --session agent:design:main" }
    }
  }
}
```

### ACP Execution Path

New method in `AgentRunner`: `executeAcpAgent(acpCommand, context)`.

1. Spawn the ACP command as a subprocess with stdio pipes
2. Send `initialize` JSON-RPC message, receive capabilities
3. Send `newSession` to create a session
4. Send `prompt` with the mention context:
   - Document content (fetched via v1 API or from local CRDT)
   - Comment text and thread history
   - Instructions derived from the mention (e.g., "You were @mentioned as @reviewer. The user asked: fix the intro")
5. Stream response events (`text_delta`) and accumulate the full response
6. Post the response back as a comment reply (same as raw command path)
7. Close the session and terminate the subprocess

### Context Assembly

The prompt sent to the ACP agent includes:

```
Document: {title}
URL: {serverUrl}/doc/{documentId}

Content:
{document markdown content}

Comment by {authorName}:
"{comment text}"

Thread context:
{previous replies if any}

You were @mentioned as @{agentName}. Please respond to this comment.
```

### Fallback

If the ACP subprocess fails to initialize or doesn't respond to the `initialize` message within 10 seconds, the daemon logs an error and marks the mention as failed. No fallback to raw command mode since `acp` and `command` are mutually exclusive config fields.

## Section 5: Remote Trigger Integration

### What

Document how to wire CollabMD's existing outbound webhooks to Claude Code remote triggers, so a mention fires a fresh Claude Code session with no local process required.

### Why

Some users don't want to run a daemon or keep Claude Code open. If their agent platform supports remote triggers (webhook-initiated sessions), the existing outbound webhook infrastructure handles this with zero CollabMD changes.

### What We Build

Nothing in CollabMD's codebase. This is a documentation and integration guide.

### Documentation Outline

A guide at `docs/agent-remote-triggers.md` covering:

1. **Create an agent API key** in org settings
2. **Create a webhook** subscribed to `comment.mention`, pointing at the remote trigger URL
3. **Configure the remote agent** with:
   - CollabMD MCP server (`--base-url` and `--api-key`)
   - System prompt: "You are a CollabMD agent. When triggered, call `collabmd_get_pending_mentions` to find your task, then respond."
4. **Payload format** the webhook sends (so users can map it to their trigger's expected format)
5. **Example configurations** for Claude Code remote triggers (when available)

### Webhook Payload (Already Exists)

```json
{
  "eventType": "comment.mention",
  "documentId": "abc-123",
  "orgId": "org-456",
  "actorId": "user-789",
  "actorSource": "browser",
  "timestamp": "2026-04-06T12:00:00Z",
  "data": {
    "commentId": "comment-xyz",
    "mentionedAgent": "reviewer"
  }
}
```

No changes needed to this payload.

## What's NOT in Scope

- **Server-side agent execution** (cloud user pastes API key, CollabMD calls LLM directly). Separate feature, separate spec.
- **WebSocket event delivery** to the daemon. The polling approach is simpler and sufficient for MVP. WebSocket push can be added later as an optimization if polling latency becomes an issue.
- **Agent registry UI changes.** The existing org settings agent/webhook management is sufficient.
- **New database tables.** No new tables needed. Mention state is derived from Yjs snapshots (existing pattern).
