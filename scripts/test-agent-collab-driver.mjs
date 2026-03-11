#!/usr/bin/env node

import { readFileSync, existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = resolve(__filename, '..')
const repoRoot = resolve(__dirname, '..')

function parseArgs(argv) {
  const options = {
    baseUrl: 'http://localhost:3000',
    agentName: `claude-code-test-${Date.now().toString(36)}`,
    docTitle: `Agent Collaboration Test ${new Date().toISOString().slice(0, 16)}`,
    sessionToken: process.env.COLLABMD_TOKEN || '',
    orgId: '',
    keepArtifacts: false,
  }

  for (let index = 0; index < argv.length; index += 1) {
    const current = argv[index]
    if (!current) continue

    if (current === '--base-url' && argv[index + 1]) {
      options.baseUrl = argv[index + 1]
      index += 1
      continue
    }
    if (current.startsWith('--base-url=')) {
      options.baseUrl = current.slice('--base-url='.length)
      continue
    }

    if (current === '--org-id' && argv[index + 1]) {
      options.orgId = argv[index + 1]
      index += 1
      continue
    }
    if (current.startsWith('--org-id=')) {
      options.orgId = current.slice('--org-id='.length)
      continue
    }

    if (current === '--agent-name' && argv[index + 1]) {
      options.agentName = argv[index + 1]
      index += 1
      continue
    }
    if (current.startsWith('--agent-name=')) {
      options.agentName = current.slice('--agent-name='.length)
      continue
    }

    if (current === '--doc-title' && argv[index + 1]) {
      options.docTitle = argv[index + 1]
      index += 1
      continue
    }
    if (current.startsWith('--doc-title=')) {
      options.docTitle = current.slice('--doc-title='.length)
      continue
    }

    if (current === '--session-token' && argv[index + 1]) {
      options.sessionToken = argv[index + 1]
      index += 1
      continue
    }
    if (current.startsWith('--session-token=')) {
      options.sessionToken = current.slice('--session-token='.length)
      continue
    }

    if (current === '--keep-artifacts') {
      options.keepArtifacts = true
      continue
    }

    if (current === '--help' || current === '-h') {
      printUsage()
      process.exit(0)
    }
  }

  options.baseUrl = normalizeBaseUrl(options.baseUrl)
  return options
}

function printUsage() {
  console.log('Usage: node scripts/test-agent-collab-driver.mjs [options]')
  console.log('')
  console.log('Options:')
  console.log('  --base-url <url>         CollabMD base URL (default: http://localhost:3000)')
  console.log('  --org-id <id>            Org ID to use; defaults to the first accessible org')
  console.log('  --agent-name <name>      Agent key name to create')
  console.log('  --doc-title <title>      Starter document title')
  console.log(
    '  --session-token <token>  Better Auth session token; defaults to COLLABMD_TOKEN or ~/.collabmd/credentials.json',
  )
  console.log(
    '  --keep-artifacts         Keep the created agent key and document instead of deleting nothing (reserved for future cleanup)',
  )
}

function normalizeBaseUrl(value) {
  return String(value || 'http://localhost:3000').replace(/\/+$/, '')
}

function readSavedSessionToken(baseUrl) {
  const credentialPath = join(homedir(), '.collabmd', 'credentials.json')
  if (!existsSync(credentialPath)) return ''

  try {
    const raw = JSON.parse(readFileSync(credentialPath, 'utf-8'))
    const exact = raw[baseUrl]
    if (exact && typeof exact.sessionToken === 'string') {
      return exact.sessionToken
    }

    const alt = raw[`${baseUrl}/`]
    if (alt && typeof alt.sessionToken === 'string') {
      return alt.sessionToken
    }
  } catch {
    return ''
  }

  return ''
}

async function requestJson(url, init = {}, description = 'request') {
  const response = await fetch(url, init)
  if (!response.ok) {
    let details = ''
    try {
      const body = await response.json()
      if (body && typeof body.error === 'string') {
        details = `: ${body.error}`
      }
    } catch {
      // Ignore parse failures.
    }

    throw new Error(`${description} failed (${response.status})${details}`)
  }

  if (response.status === 204) return null
  return response.json()
}

function extractOrganizations(payload) {
  if (Array.isArray(payload)) {
    return payload
      .filter(
        (entry) =>
          entry &&
          typeof entry === 'object' &&
          typeof entry.id === 'string' &&
          typeof entry.name === 'string',
      )
      .map((entry) => ({ id: entry.id, name: entry.name }))
  }

  if (payload && typeof payload === 'object' && Array.isArray(payload.organizations)) {
    return extractOrganizations(payload.organizations)
  }

  return []
}

async function resolveOrganization(baseUrl, sessionToken, requestedOrgId) {
  const headers = {
    Authorization: `Bearer ${sessionToken}`,
    'Content-Type': 'application/json',
  }

  const orgList = extractOrganizations(
    await requestJson(`${baseUrl}/api/auth/organization/list`, { headers }, 'organization list'),
  )

  if (requestedOrgId) {
    const explicit = orgList.find((org) => org.id === requestedOrgId)
    if (!explicit) {
      throw new Error(`org ${requestedOrgId} is not accessible to the current session`)
    }
    return explicit
  }

  if (orgList.length > 0) return orgList[0]

  const created = await requestJson(
    `${baseUrl}/api/auth/organization/create`,
    {
      method: 'POST',
      headers,
      body: JSON.stringify({ name: 'Agent Collaboration Test Org' }),
    },
    'organization create',
  )

  const createdId =
    typeof created?.id === 'string'
      ? created.id
      : typeof created?.organization?.id === 'string'
        ? created.organization.id
        : ''
  const createdName =
    typeof created?.name === 'string'
      ? created.name
      : typeof created?.organization?.name === 'string'
        ? created.organization.name
        : 'Agent Collaboration Test Org'

  if (!createdId) {
    throw new Error('organization create succeeded but did not return an org id')
  }

  return { id: createdId, name: createdName }
}

function starterContent() {
  return [
    '# Agent Collaboration Test',
    '',
    'This document is used to verify Claude Code and the CollabMD MCP server can collaborate in real time.',
    '',
    'Anchor phrase: collaborative editing baseline.',
    'Suggestion target: replace this sentence exactly.',
    '',
    '## Checklist',
    '- Human confirms the comment appears in the web UI.',
    '- Human accepts or dismisses the suggestion.',
    '- Human opens the discussion thread.',
  ].join('\n')
}

function getTextContent(result) {
  if (!result || !Array.isArray(result.content)) return ''
  return result.content
    .filter((entry) => entry && entry.type === 'text' && typeof entry.text === 'string')
    .map((entry) => entry.text)
    .join('\n')
}

async function callToolText(client, name, args = {}) {
  const result = await client.callTool({ name, arguments: args })
  if (result.isError) {
    throw new Error(`${name} returned an MCP error: ${getTextContent(result)}`)
  }
  return getTextContent(result)
}

function parseJsonText(text, label) {
  try {
    return JSON.parse(text)
  } catch (error) {
    throw new Error(
      `failed to parse ${label} JSON: ${error instanceof Error ? error.message : String(error)}`,
    )
  }
}

async function runMcpFlow({ baseUrl, apiKey, documentId }) {
  const transport = new StdioClientTransport({
    command: 'pnpm',
    args: [
      'exec',
      'tsx',
      'packages/collabmd/src/cli/index.ts',
      'mcp',
      '--api-key',
      apiKey,
      '--base-url',
      baseUrl,
    ],
    cwd: repoRoot,
    env: process.env,
    stderr: 'pipe',
  })

  if (transport.stderr) {
    transport.stderr.on('data', (chunk) => {
      const message = chunk.toString().trim()
      if (message) process.stderr.write(`${message}\n`)
    })
  }

  const client = new Client(
    { name: 'collabmd-agent-collab-test', version: '0.1.0' },
    { capabilities: {} },
  )

  try {
    await client.connect(transport)

    const listedTools = await client.listTools()
    const toolNames = listedTools.tools.map((tool) => tool.name)

    const listedDocuments = parseJsonText(
      await callToolText(client, 'collabmd_list_documents'),
      'document list',
    )
    const documentListEntry = Array.isArray(listedDocuments)
      ? listedDocuments.find((entry) => entry && entry.id === documentId)
      : null
    if (!documentListEntry) {
      throw new Error(`document ${documentId} was not visible to the MCP agent`)
    }

    const documentContent = await callToolText(client, 'collabmd_read_document', { documentId })

    await callToolText(client, 'collabmd_add_comment', {
      documentId,
      text: 'Agent comment: this paragraph is ready for manual verification.',
      anchorText: 'collaborative editing baseline',
    })

    await callToolText(client, 'collabmd_suggest_edit', {
      documentId,
      anchorText: 'replace this sentence exactly.',
      proposedText: 'replace this sentence with the agent-approved wording.',
      note: 'Agent suggestion: tighten the wording for the manual test.',
    })

    await callToolText(client, 'collabmd_add_discussion', {
      documentId,
      title: 'Agent discussion thread',
      text: 'Agent discussion: confirm this appears live in the discussion panel.',
    })

    const comments = parseJsonText(
      await callToolText(client, 'collabmd_list_comments', { documentId }),
      'comments list',
    )
    const discussions = parseJsonText(
      await callToolText(client, 'collabmd_list_discussions', { documentId }),
      'discussions list',
    )

    const suggestionCount = Array.isArray(comments)
      ? comments.filter((entry) => entry && entry.suggestion).length
      : 0

    return {
      toolNames,
      documentPreview: documentContent,
      commentCount: Array.isArray(comments) ? comments.length : 0,
      suggestionCount,
      discussionCount: Array.isArray(discussions) ? discussions.length : 0,
    }
  } finally {
    await transport.close()
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2))
  const sessionToken = options.sessionToken || readSavedSessionToken(options.baseUrl)

  if (!sessionToken) {
    throw new Error(
      `no session token found for ${options.baseUrl}; run "pnpm exec collabmd login --server ${options.baseUrl}" or set COLLABMD_TOKEN`,
    )
  }

  const organization = await resolveOrganization(options.baseUrl, sessionToken, options.orgId)
  const userHeaders = {
    Authorization: `Bearer ${sessionToken}`,
    'Content-Type': 'application/json',
  }

  const apiKeyRecord = await requestJson(
    `${options.baseUrl}/api/orgs/${encodeURIComponent(organization.id)}/agent-keys`,
    {
      method: 'POST',
      headers: userHeaders,
      body: JSON.stringify({
        name: options.agentName,
        scopes: {},
      }),
    },
    'agent key create',
  )

  if (!apiKeyRecord || typeof apiKeyRecord.key !== 'string') {
    throw new Error('agent key create succeeded but did not return a raw key')
  }

  const document = await requestJson(
    `${options.baseUrl}/api/documents`,
    {
      method: 'POST',
      headers: userHeaders,
      body: JSON.stringify({
        title: options.docTitle,
        orgId: organization.id,
      }),
    },
    'document create',
  )

  if (!document || typeof document.id !== 'string') {
    throw new Error('document create succeeded but did not return a document id')
  }

  await requestJson(
    `${options.baseUrl}/api/v1/documents/${encodeURIComponent(document.id)}/content`,
    {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${apiKeyRecord.key}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ content: starterContent() }),
    },
    'starter content write',
  )

  const mcp = await runMcpFlow({
    baseUrl: options.baseUrl,
    apiKey: apiKeyRecord.key,
    documentId: document.id,
  })

  const summary = {
    baseUrl: options.baseUrl,
    organization,
    agent: {
      name: options.agentName,
      key: apiKeyRecord.key,
      keyPrefix: apiKeyRecord.keyPrefix,
    },
    document: {
      id: document.id,
      title: options.docTitle,
      url: `${options.baseUrl}/doc/${document.id}`,
    },
    claudeCode: {
      command: `pnpm exec collabmd mcp --api-key ${apiKeyRecord.key} --base-url ${options.baseUrl}`,
      settingsSnippet: {
        mcpServers: {
          collabmd: {
            command: 'pnpm',
            args: [
              'exec',
              'collabmd',
              'mcp',
              '--api-key',
              apiKeyRecord.key,
              '--base-url',
              options.baseUrl,
            ],
          },
        },
      },
    },
    mcp,
    keepArtifacts: options.keepArtifacts,
  }

  console.log(JSON.stringify(summary, null, 2))
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error)
  console.error(`test-agent-collab failed: ${message}`)
  process.exit(1)
})
