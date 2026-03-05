import { NextResponse } from 'next/server'
import { headers } from 'next/headers'
import { auth } from '@/lib/auth'
import { db, documents, eq, and, isNotNull, desc } from '@collabmd/db'

export async function GET() {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const trashed = db
    .select()
    .from(documents)
    .where(and(eq(documents.ownerId, session.user.id), isNotNull(documents.deletedAt)))
    .orderBy(desc(documents.deletedAt))
    .all()

  return NextResponse.json(trashed)
}
