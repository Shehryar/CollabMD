#!/usr/bin/env node

import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import {
  type Resource,
  type Tool,
  CallToolRequestSchema,
  ListResourcesRequestSchema,
  ListToolsRequestSchema,
  ReadResourceRequestSchema,
} from '@modelcontextprotocol/sdk/types.js'
import { CollabMDClient } from './api-client.js'

interface CliOptions {
  serverUrl?: string
  apiKey?: string
  help?: boolean
}

const TOOLS: Tool[] = [
  {
    name: 'collabmd_list_documents',
    description:
      'List documents the API key can access. Use this before reading or editing a document.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'collabmd_read_document',
    description: 'Read the current markdown content for a specific CollabMD document.',
    inputSchema: {
      type: 'object',
      properties: {
        documentId: { type: 'string', description: 'The document ID to read.' },
      },
      required: ['documentId'],
    },
  },
  {
    name: 'collabmd_write_document',
    description: 'Overwrite a document with new markdown content.',
    inputSchema: {
      type: 'object',
      properties: {
        documentId: { type: 'string', description: 'The document ID to update.' },
        content: { type: 'string', description: 'The full markdown content to write.' },
      },
      required: ['documentId', 'content'],
    },
  },
  {
    name: 'collabmd_list_comments',
    description: 'List comments and suggestion threads for a document.',
    inputSchema: {
      type: 'object',
      properties: {
        documentId: { type: 'string', description: 'The document ID to inspect.' },
      },
      required: ['documentId'],
    },
  },
  {
    name: 'collabmd_add_comment',
    description:
      'Create a new anchored comment. If anchorText is omitted, it anchors to the first character in a non-empty document. If anchorText appears multiple times, the call fails and you must provide a unique anchor.',
    inputSchema: {
      type: 'object',
      properties: {
        documentId: { type: 'string', description: 'The document ID to comment on.' },
        text: { type: 'string', description: 'Comment body text.' },
        anchorText: { type: 'string', description: 'Optional exact text to anchor the comment.' },
      },
      required: ['documentId', 'text'],
    },
  },
  {
    name: 'collabmd_list_discussions',
    description: 'List document-level discussion threads for a document.',
    inputSchema: {
      type: 'object',
      properties: {
        documentId: { type: 'string', description: 'The document ID to inspect.' },
      },
      required: ['documentId'],
    },
  },
  {
    name: 'collabmd_add_discussion',
    description: 'Create a new discussion thread on a document.',
    inputSchema: {
      type: 'object',
      properties: {
        documentId: { type: 'string', description: 'The document ID to post to.' },
        title: { type: 'string', description: 'Discussion title.' },
        text: { type: 'string', description: 'Discussion body text.' },
      },
      required: ['documentId', 'title', 'text'],
    },
  },
  {
    name: 'collabmd_suggest_edit',
    description:
      'Suggest an edit to a document. The suggestion appears as a tracked change that can be accepted or dismissed. Use this when the org policy requires suggest-only, or when you want to propose a change rather than directly editing.',
    inputSchema: {
      type: 'object',
      properties: {
        documentId: { type: 'string', description: 'The document ID to suggest an edit for.' },
        anchorText: {
          type: 'string',
          description: 'Exact text in the document to replace. Must be unique.',
        },
        proposedText: { type: 'string', description: 'The replacement text to propose.' },
        note: { type: 'string', description: 'Optional note explaining the suggestion.' },
      },
      required: ['documentId', 'anchorText', 'proposedText'],
    },
  },
  {
    name: 'collabmd_get_pending_mentions',
    description:
      'Get comments where this agent is @mentioned but has not yet replied. Use this to discover work assigned to you via @mentions.',
    inputSchema: {
      type: 'object',
      properties: {
        documentId: {
          type: 'string',
          description: 'Optional document ID to filter mentions to a specific document.',
        },
      },
    },
  },
]

function parseCliArgs(argv: string[]): CliOptions {
  const options: CliOptions = {}

  for (let index = 0; index < argv.length; index += 1) {
    const current = argv[index]
    if (!current) continue

    if (current === '--help' || current === '-h') {
      options.help = true
      continue
    }

    if (current === '--server-url') {
      options.serverUrl = argv[index + 1]
      index += 1
      continue
    }
    if (current.startsWith('--server-url=')) {
      options.serverUrl = current.slice('--server-url='.length)
      continue
    }

    if (current === '--api-key') {
      options.apiKey = argv[index + 1]
      index += 1
      continue
    }
    if (current.startsWith('--api-key=')) {
      options.apiKey = current.slice('--api-key='.length)
      continue
    }
  }

  return options
}

function printUsage(): void {
  console.error('Usage: collabmd-mcp --server-url <url> --api-key <ak_...>')
  console.error('You can also set COLLABMD_SERVER_URL and COLLABMD_API_KEY.')
}

function makeToolText(text: string, isError = false) {
  return {
    isError,
    content: [{ type: 'text' as const, text }],
  }
}

function readRequiredString(args: Record<string, unknown>, key: string): string {
  const value = args[key]
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`"${key}" must be a non-empty string`)
  }
  return value
}

function toResourceUri(documentId: string): string {
  return `collabmd://documents/${encodeURIComponent(documentId)}`
}

function parseDocumentIdFromResourceUri(uri: string): string {
  const parsed = new URL(uri)
  if (parsed.protocol !== 'collabmd:' || parsed.hostname !== 'documents') {
    throw new Error(`Unsupported resource URI: ${uri}`)
  }

  const documentId = decodeURIComponent(parsed.pathname.replace(/^\/+/, ''))
  if (!documentId) {
    throw new Error(`Missing document ID in resource URI: ${uri}`)
  }

  return documentId
}

function createResources(documents: Array<{ id: string; title: string }>): Resource[] {
  return documents.map((document) => ({
    uri: toResourceUri(document.id),
    name: document.title || document.id,
    description: `CollabMD document ${document.id}`,
    mimeType: 'text/markdown',
  }))
}

async function start(): Promise<void> {
  const options = parseCliArgs(process.argv.slice(2))
  if (options.help) {
    printUsage()
    process.exit(0)
  }

  const serverUrl = options.serverUrl || process.env.COLLABMD_SERVER_URL
  const apiKey = options.apiKey || process.env.COLLABMD_API_KEY
  if (!serverUrl || !apiKey) {
    printUsage()
    process.exit(1)
  }

  const client = new CollabMDClient(serverUrl, apiKey)
  const server = new Server(
    {
      name: '@collabmd/mcp-server',
      version: '0.1.0',
    },
    {
      capabilities: {
        tools: {},
        resources: {},
      },
    },
  )

  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }))

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const args = request.params.arguments ?? {}
    try {
      switch (request.params.name) {
        case 'collabmd_list_documents': {
          const docs = await client.listDocuments()
          return makeToolText(
            JSON.stringify(
              docs.map((doc) => ({ id: doc.id, title: doc.title })),
              null,
              2,
            ),
          )
        }
        case 'collabmd_read_document': {
          const documentId = readRequiredString(args, 'documentId')
          const doc = await client.readDocument(documentId)
          return makeToolText(doc.content)
        }
        case 'collabmd_write_document': {
          const documentId = readRequiredString(args, 'documentId')
          const content = readRequiredString(args, 'content')
          await client.writeDocument(documentId, content)
          return makeToolText(`Updated document ${documentId}.`)
        }
        case 'collabmd_list_comments': {
          const documentId = readRequiredString(args, 'documentId')
          const comments = await client.listComments(documentId)
          return makeToolText(JSON.stringify(comments, null, 2))
        }
        case 'collabmd_add_comment': {
          const documentId = readRequiredString(args, 'documentId')
          const text = readRequiredString(args, 'text')
          const anchorText = typeof args.anchorText === 'string' ? args.anchorText : undefined
          await client.addComment(documentId, text, anchorText)
          return makeToolText(`Added comment to document ${documentId}.`)
        }
        case 'collabmd_list_discussions': {
          const documentId = readRequiredString(args, 'documentId')
          const discussions = await client.listDiscussions(documentId)
          return makeToolText(JSON.stringify(discussions, null, 2))
        }
        case 'collabmd_add_discussion': {
          const documentId = readRequiredString(args, 'documentId')
          const title = readRequiredString(args, 'title')
          const text = readRequiredString(args, 'text')
          await client.addDiscussion(documentId, title, text)
          return makeToolText(`Added discussion "${title}" to document ${documentId}.`)
        }
        case 'collabmd_suggest_edit': {
          const documentId = readRequiredString(args, 'documentId')
          const anchorText = readRequiredString(args, 'anchorText')
          const proposedText = readRequiredString(args, 'proposedText')
          const note = typeof args.note === 'string' ? args.note : undefined
          await client.suggestEdit(documentId, anchorText, proposedText, note)
          return makeToolText(`Created suggestion on document ${documentId}.`)
        }
        case 'collabmd_get_pending_mentions': {
          const documentId = typeof args.documentId === 'string' ? args.documentId : undefined
          const mentions = await client.getPendingMentions(documentId)
          return makeToolText(JSON.stringify(mentions, null, 2))
        }
        default:
          return makeToolText(`Unknown tool: ${request.params.name}`, true)
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'tool execution failed'
      return makeToolText(message, true)
    }
  })

  server.setRequestHandler(ListResourcesRequestSchema, async () => {
    const docs = await client.listDocuments()
    return { resources: createResources(docs) }
  })

  server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
    const documentId = parseDocumentIdFromResourceUri(request.params.uri)
    const doc = await client.readDocument(documentId)
    return {
      contents: [
        {
          uri: request.params.uri,
          mimeType: 'text/markdown',
          text: doc.content,
        },
      ],
    }
  })

  const transport = new StdioServerTransport()
  await server.connect(transport)
}

await start()
