import { NextRequest, NextResponse } from 'next/server'
import { headers } from 'next/headers'
import { auth } from '@/lib/auth'
import { db, documents, folders, organizations, eq, and, isNull } from '@collabmd/db'
import { checkPermission, writeTuple, readTuples, deleteTuple } from '@collabmd/shared'
import { enforceUserMutationRateLimit, getClientIp } from '@/lib/rate-limit'
import { requireJsonContentType } from '@/lib/http'

type DocumentPermission = 'owner' | 'editor' | 'commenter' | 'viewer'
type AgentPolicy = 'enabled' | 'restricted' | 'disabled'

function parseOrgAgentPolicy(metadata: string | null): AgentPolicy {
  try {
    const parsed = metadata ? JSON.parse(metadata) : {}
    if (parsed.agentPolicy === 'enabled' || parsed.agentPolicy === 'restricted' || parsed.agentPolicy === 'disabled') {
      return parsed.agentPolicy
    }
  } catch {
    // Ignore invalid JSON and return default.
  }
  return 'enabled'
}

async function validateFolderForDocument(
  userId: string,
  docOrgId: string,
  folderId: string,
): Promise<{ ok: true } | { ok: false; status: number; error: string }> {
  const folder = db.select().from(folders).where(eq(folders.id, folderId)).get()
  if (!folder) {
    return { ok: false, status: 404, error: 'folder not found' }
  }

  if (folder.orgId !== docOrgId) {
    return { ok: false, status: 400, error: 'folder belongs to a different organization' }
  }

  const canEditFolder = await checkPermission(userId, 'can_edit', 'folder', folderId)
  if (!canEditFolder) {
    return { ok: false, status: 403, error: 'forbidden' }
  }

  return { ok: true }
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const { id } = await params
  const canView = await checkPermission(session.user.id, 'can_view', 'document', id)
  if (!canView) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }

  let permission: DocumentPermission = 'viewer'
  const isOwner = await checkPermission(session.user.id, 'owner', 'document', id)
  if (isOwner) {
    permission = 'owner'
  } else {
    const canEdit = await checkPermission(session.user.id, 'can_edit', 'document', id)
    if (canEdit) {
      permission = 'editor'
    } else {
      const canComment = await checkPermission(session.user.id, 'can_comment', 'document', id)
      if (canComment) {
        permission = 'commenter'
      }
    }
  }

  const doc = db
    .select()
    .from(documents)
    .where(and(eq(documents.id, id), isNull(documents.deletedAt)))
    .get()

  if (!doc) {
    return NextResponse.json({ error: 'not found' }, { status: 404 })
  }

  let orgAgentPolicy: AgentPolicy = 'enabled'
  const org = db
    .select({ metadata: organizations.metadata })
    .from(organizations)
    .where(eq(organizations.id, doc.orgId))
    .get()

  orgAgentPolicy = parseOrgAgentPolicy(org?.metadata ?? null)

  return NextResponse.json({
    ...doc,
    permission,
    agentEditable: doc.agentEditable,
    orgAgentPolicy,
  })
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const rateLimitError = enforceUserMutationRateLimit(session.user.id, { ip: getClientIp(request) })
  if (rateLimitError) return rateLimitError

  const contentTypeError = requireJsonContentType(request)
  if (contentTypeError) return contentTypeError

  const { id } = await params
  const canEdit = await checkPermission(session.user.id, 'can_edit', 'document', id)
  if (!canEdit) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }

  const existing = db
    .select()
    .from(documents)
    .where(and(eq(documents.id, id), isNull(documents.deletedAt)))
    .get()

  if (!existing) {
    return NextResponse.json({ error: 'not found' }, { status: 404 })
  }

  const body = await request.json()
  const { title, folderId, agentEditable } = body as {
    title?: string
    folderId?: string | null
    agentEditable?: boolean
  }

  // agentEditable can only be changed by the document owner
  if (agentEditable !== undefined) {
    const isOwner = await checkPermission(session.user.id, 'owner', 'document', id)
    if (!isOwner) {
      return NextResponse.json({ error: 'only the document owner can change agent editability' }, { status: 403 })
    }
  }

  if (folderId) {
    const folderCheck = await validateFolderForDocument(session.user.id, existing.orgId, folderId)
    if (!folderCheck.ok) {
      return NextResponse.json({ error: folderCheck.error }, { status: folderCheck.status })
    }
  }

  const updates: Record<string, unknown> = { updatedAt: new Date() }
  if (title !== undefined) updates.title = title
  if (folderId !== undefined) updates.folderId = folderId
  if (agentEditable !== undefined) updates.agentEditable = agentEditable

  const updated = db
    .update(documents)
    .set(updates)
    .where(eq(documents.id, id))
    .returning()
    .get()

  if (!updated) {
    return NextResponse.json({ error: 'not found' }, { status: 404 })
  }

  // Update FGA parent tuple when folderId changes
  if (folderId !== undefined) {
    // Remove existing parent folder tuples
    const tuples = await readTuples(`document:${id}`)
    for (const t of tuples) {
      if (t.relation === 'parent' && t.user.startsWith('folder:')) {
        await deleteTuple(t.user, 'parent', `document:${id}`)
      }
    }
    // Add new parent tuple if moving to a folder
    if (folderId) {
      await writeTuple(`folder:${folderId}`, 'parent', `document:${id}`)
    }
  }

  return NextResponse.json(updated)
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const rateLimitError = enforceUserMutationRateLimit(session.user.id, { ip: getClientIp(request) })
  if (rateLimitError) return rateLimitError

  const { id } = await params
  const isOwner = await checkPermission(session.user.id, 'owner', 'document', id)
  if (!isOwner) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }

  const doc = db.select().from(documents).where(eq(documents.id, id)).get()
  if (!doc) {
    return NextResponse.json({ error: 'not found' }, { status: 404 })
  }

  // Soft-delete and revoke FGA tuples to block further sync/read access while in trash.
  db.update(documents)
    .set({ deletedAt: new Date() })
    .where(eq(documents.id, id))
    .run()

  const tuples = await readTuples(`document:${id}`)
  for (const t of tuples) {
    await deleteTuple(t.user, t.relation, `document:${id}`)
  }

  return NextResponse.json({ ok: true })
}
