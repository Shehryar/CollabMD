import { NextRequest, NextResponse } from 'next/server'
import { checkPermission } from '@collabmd/shared'
import { db, documents, organizations, and, eq, isNull } from '@collabmd/db'
import { rateLimit, rateLimitResponse } from '@/lib/rate-limit'
import { authenticateAgentKey, type AgentKeyContext } from '@/lib/agent-key-auth'

const AGENT_KEY_RATE_LIMIT = 100
const AGENT_KEY_RATE_WINDOW_MS = 60_000

type RequiredRelation = 'can_view' | 'can_comment' | 'can_edit'

function isScopeAllowed(
  context: AgentKeyContext,
  doc: { id: string; folderId: string | null },
): boolean {
  const scopedDocs = context.scopes.documents
  if (Array.isArray(scopedDocs)) {
    if (scopedDocs.length === 0) return false
    if (!scopedDocs.includes(doc.id)) return false
  }

  const scopedFolders = context.scopes.folders
  if (Array.isArray(scopedFolders)) {
    if (scopedFolders.length === 0) return false
    if (!doc.folderId) return false
    if (!scopedFolders.includes(doc.folderId)) return false
  }

  return true
}

export async function authorizeAgentForDocument(
  request: NextRequest,
  docId: string,
  relation: RequiredRelation,
): Promise<
  | {
      context: AgentKeyContext
      document: {
        id: string
        orgId: string
        folderId: string | null
        agentEditable: boolean
      }
      agentPolicy: string
    }
  | {
      error: NextResponse
    }
> {
  const authResult = await authenticateAgentKey(request)
  if ('error' in authResult) return authResult

  const rate = rateLimit(
    `agent-key:${authResult.context.keyId}:v1`,
    AGENT_KEY_RATE_LIMIT,
    AGENT_KEY_RATE_WINDOW_MS,
  )
  if (!rate.success) {
    return {
      error: rateLimitResponse(rate, AGENT_KEY_RATE_LIMIT),
    }
  }

  const document = db
    .select({
      id: documents.id,
      orgId: documents.orgId,
      folderId: documents.folderId,
      agentEditable: documents.agentEditable,
    })
    .from(documents)
    .where(and(eq(documents.id, docId), isNull(documents.deletedAt)))
    .get()

  if (!document) {
    return { error: NextResponse.json({ error: 'not found' }, { status: 404 }) }
  }

  if (document.orgId !== authResult.context.orgId) {
    return { error: NextResponse.json({ error: 'forbidden' }, { status: 403 }) }
  }

  const org = db.select().from(organizations).where(eq(organizations.id, document.orgId)).get()
  let agentPolicy = 'enabled'
  if (org?.metadata) {
    try {
      const parsed = JSON.parse(org.metadata)
      if (typeof parsed.agentPolicy === 'string') {
        agentPolicy = parsed.agentPolicy
      }
    } catch {
      // invalid JSON, keep default
    }
  }

  if (!isScopeAllowed(authResult.context, document)) {
    return { error: NextResponse.json({ error: 'forbidden by key scope' }, { status: 403 }) }
  }

  if (relation !== 'can_view' && document.agentEditable !== true) {
    return {
      error: NextResponse.json({ error: 'document is not agent-editable' }, { status: 403 }),
    }
  }

  const allowed = await checkPermission(
    authResult.context.permissionUserId,
    relation,
    'document',
    docId,
  )
  if (!allowed) {
    return { error: NextResponse.json({ error: 'forbidden' }, { status: 403 }) }
  }

  return {
    context: authResult.context,
    document,
    agentPolicy,
  }
}
