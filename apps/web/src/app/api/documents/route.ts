import { NextRequest, NextResponse } from 'next/server'
import { headers } from 'next/headers'
import { auth } from '@/lib/auth'
import { db, documents, organizations, folders, members, and, eq, isNull, inArray, desc, like, ne } from '@collabmd/db'
import { writeTuple, listAccessibleObjects, checkPermission } from '@collabmd/shared'
import { enforceUserMutationRateLimit, getClientIp } from '@/lib/rate-limit'
import { requireJsonContentType } from '@/lib/http'

function isPermissionsServiceUnavailable(error: unknown): boolean {
  if (!(error instanceof Error)) return false
  return /ECONNREFUSED|fetch failed|connect|openfga/i.test(error.message)
}

function permissionsUnavailableResponse() {
  return NextResponse.json(
    { error: 'Permissions service unavailable. Start the full dev stack with `pnpm dev`.' },
    { status: 503 },
  )
}

export async function POST(request: NextRequest) {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const rateLimitError = enforceUserMutationRateLimit(session.user.id, { ip: getClientIp(request) })
  if (rateLimitError) return rateLimitError

  const contentTypeError = requireJsonContentType(request)
  if (contentTypeError) return contentTypeError

  const body = await request.json()
  const { title, orgId, folderId, source } = body as {
    title: string
    orgId: string
    folderId?: string
    source?: string
  }

  if (!title || !orgId) {
    return NextResponse.json({ error: 'title and org id are required' }, { status: 400 })
  }

  const membership = db
    .select()
    .from(members)
    .where(and(eq(members.organizationId, orgId), eq(members.userId, session.user.id)))
    .get()
  if (!membership) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }

  if (folderId) {
    const folder = db.select().from(folders).where(eq(folders.id, folderId)).get()
    if (!folder) {
      return NextResponse.json({ error: 'folder not found' }, { status: 404 })
    }
    if (folder.orgId !== orgId) {
      return NextResponse.json({ error: 'folder belongs to a different organization' }, { status: 400 })
    }
    let canEditFolder = false
    try {
      canEditFolder = await checkPermission(session.user.id, 'can_edit', 'folder', folderId)
    } catch (error) {
      if (isPermissionsServiceUnavailable(error)) {
        console.warn('[api/documents:POST] permissions unavailable during folder permission check', error)
        return permissionsUnavailableResponse()
      }
      throw error
    }
    if (!canEditFolder) {
      return NextResponse.json({ error: 'forbidden' }, { status: 403 })
    }
  }

  const id = crypto.randomUUID()
  const now = new Date()

  const doc = db
    .insert(documents)
    .values({
      id,
      title,
      source: source === 'daemon' ? 'daemon' : 'web',
      orgId,
      ownerId: session.user.id,
      folderId: folderId ?? null,
      createdAt: now,
      updatedAt: now,
    })
    .returning()
    .get()

  try {
    await writeTuple(`user:${session.user.id}`, 'owner', `document:${id}`)
    await writeTuple(`org:${orgId}`, 'org', `document:${id}`)

    if (folderId) {
      await writeTuple(`folder:${folderId}`, 'parent', `document:${id}`)
    }

    // Apply org-level default document permissions
    const org = db.select().from(organizations).where(eq(organizations.id, orgId)).get()
    if (org?.metadata) {
      try {
        const meta = JSON.parse(org.metadata)
        const defaultPerm = meta.defaultDocPermission as string | undefined
        if (defaultPerm && defaultPerm !== 'none') {
          const orgMembers = db
            .select()
            .from(members)
            .where(eq(members.organizationId, orgId))
            .all()

          const tuplePromises = orgMembers
            .filter((m) => m.userId !== session.user.id)
            .map((m) => writeTuple(`user:${m.userId}`, defaultPerm, `document:${id}`))

          await Promise.all(tuplePromises)
        }
      } catch {
        // invalid metadata JSON, skip defaults
      }
    }
  } catch (error) {
    try {
      db.delete(documents).where(eq(documents.id, id)).run()
    } catch {
      // best effort cleanup
    }
    if (isPermissionsServiceUnavailable(error)) {
      console.warn('[api/documents:POST] permissions unavailable during tuple writes', error)
      return permissionsUnavailableResponse()
    }
    throw error
  }

  return NextResponse.json(doc, { status: 201 })
}

export async function GET(request: NextRequest) {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const { searchParams } = request.nextUrl
  const folderId = searchParams.get('folderId')
  const shared = searchParams.get('shared') === 'true'
  const search = searchParams.get('search')

  let accessible: string[]
  try {
    accessible = await listAccessibleObjects(session.user.id, 'can_view', 'document')
  } catch (error) {
    if (isPermissionsServiceUnavailable(error)) {
      console.warn('[api/documents:GET] permissions unavailable during document listing', error)
      return permissionsUnavailableResponse()
    }
    throw error
  }
  const docIds = accessible.map((obj) => obj.replace('document:', ''))

  if (docIds.length === 0) {
    return NextResponse.json([])
  }

  const conditions = [
    inArray(documents.id, docIds),
    isNull(documents.deletedAt),
  ]

  if (folderId) {
    conditions.push(eq(documents.folderId, folderId))
  }

  if (shared) {
    conditions.push(ne(documents.ownerId, session.user.id))
  }

  if (search) {
    conditions.push(like(documents.title, `%${search}%`))
  }

  const docs = db
    .select()
    .from(documents)
    .where(and(...conditions))
    .orderBy(desc(documents.updatedAt))
    .all()

  return NextResponse.json(docs)
}
