import crypto from 'node:crypto'
import { NextRequest, NextResponse } from 'next/server'
import { db, agentKeys, and, eq, isNull } from '@collabmd/db'

export interface AgentKeyScopes {
  documents?: string[]
  folders?: string[]
}

export interface AgentKeyContext {
  keyId: string
  keyPrefix: string
  orgId: string
  name: string
  actorId: string
  permissionUserId: string
  scopes: AgentKeyScopes
}

function parseScopes(value: string): AgentKeyScopes {
  try {
    const parsed = JSON.parse(value) as Record<string, unknown>
    const documents = Array.isArray(parsed.documents)
      ? parsed.documents.filter((entry): entry is string => typeof entry === 'string')
      : undefined
    const folders = Array.isArray(parsed.folders)
      ? parsed.folders.filter((entry): entry is string => typeof entry === 'string')
      : undefined
    return { documents, folders }
  } catch {
    return {}
  }
}

function extractAgentToken(request: NextRequest): string | null {
  const header = request.headers.get('authorization')
  if (!header || !header.startsWith('Bearer ')) return null
  const token = header.slice('Bearer '.length).trim()
  if (!token.startsWith('ak_')) return null
  return token
}

export async function authenticateAgentKey(request: NextRequest): Promise<{
  context: AgentKeyContext
} | {
  error: NextResponse
}> {
  const rawKey = extractAgentToken(request)
  if (!rawKey) {
    return {
      error: NextResponse.json({ error: 'missing or invalid api key' }, { status: 401 }),
    }
  }

  const hash = crypto.createHash('sha256').update(rawKey).digest('hex')
  const key = db
    .select()
    .from(agentKeys)
    .where(and(eq(agentKeys.keyHash, hash), isNull(agentKeys.revokedAt)))
    .get()

  if (!key) {
    return {
      error: NextResponse.json({ error: 'invalid api key' }, { status: 401 }),
    }
  }

  db.update(agentKeys)
    .set({ lastUsedAt: new Date() })
    .where(eq(agentKeys.id, key.id))
    .run()

  return {
    context: {
      keyId: key.id,
      keyPrefix: key.keyPrefix,
      orgId: key.orgId,
      name: key.name,
      actorId: `agent-key:${key.id}`,
      permissionUserId: key.createdBy,
      scopes: parseScopes(key.scopes),
    },
  }
}
