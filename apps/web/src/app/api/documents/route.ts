import { NextRequest, NextResponse } from 'next/server'
import { headers } from 'next/headers'
import { auth } from '@/lib/auth'
import { db, documents, organizations, members, and, eq, isNull, inArray, desc, like, ne } from '@collabmd/db'
import { writeTuple, listAccessibleObjects } from '@collabmd/shared'
import { rateLimit, rateLimitResponse } from '@/lib/rate-limit'

export async function POST(request: NextRequest) {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const rl = rateLimit(`user:${session.user.id}:mutation`, 100, 60_000)
  if (!rl.success) return rateLimitResponse(rl, 100)

  const body = await request.json()
  const { title, orgId, folderId } = body as {
    title: string
    orgId: string
    folderId?: string
  }

  if (!title || !orgId) {
    return NextResponse.json({ error: 'title and orgId are required' }, { status: 400 })
  }

  const id = crypto.randomUUID()
  const now = new Date()

  const doc = db
    .insert(documents)
    .values({
      id,
      title,
      orgId,
      ownerId: session.user.id,
      folderId: folderId ?? null,
      createdAt: now,
      updatedAt: now,
    })
    .returning()
    .get()

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

  return NextResponse.json(doc, { status: 201 })
}

export async function GET(request: NextRequest) {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { searchParams } = request.nextUrl
  const folderId = searchParams.get('folderId')
  const shared = searchParams.get('shared') === 'true'
  const search = searchParams.get('search')

  const accessible = await listAccessibleObjects(session.user.id, 'can_view', 'document')
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
