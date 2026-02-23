import { NextRequest, NextResponse } from 'next/server'
import { db, documents, and, eq, isNull, inArray, desc } from '@collabmd/db'
import { authenticateAgentKey } from '@/lib/agent-key-auth'
import { rateLimit, rateLimitResponse } from '@/lib/rate-limit'

const AGENT_KEY_RATE_LIMIT = 100
const AGENT_KEY_RATE_WINDOW_MS = 60_000
const DEFAULT_PAGE_SIZE = 50
const MAX_PAGE_SIZE = 200

function parsePositiveInt(value: string | null, fallback: number): number {
  if (!value) return fallback
  const parsed = Number.parseInt(value, 10)
  if (!Number.isFinite(parsed) || parsed < 0) return fallback
  return parsed
}

export async function GET(request: NextRequest) {
  const authResult = await authenticateAgentKey(request)
  if ('error' in authResult) return authResult.error

  const rate = rateLimit(`agent-key:${authResult.context.keyId}:v1`, AGENT_KEY_RATE_LIMIT, AGENT_KEY_RATE_WINDOW_MS)
  if (!rate.success) {
    return rateLimitResponse(rate, AGENT_KEY_RATE_LIMIT)
  }

  const conditions = [
    eq(documents.orgId, authResult.context.orgId),
    isNull(documents.deletedAt),
  ]

  const scopedDocuments = authResult.context.scopes.documents
  if (Array.isArray(scopedDocuments)) {
    if (scopedDocuments.length === 0) return NextResponse.json([])
    conditions.push(inArray(documents.id, scopedDocuments))
  }

  const scopedFolders = authResult.context.scopes.folders
  if (Array.isArray(scopedFolders)) {
    if (scopedFolders.length === 0) return NextResponse.json([])
    conditions.push(inArray(documents.folderId, scopedFolders))
  }

  const limit = Math.min(MAX_PAGE_SIZE, Math.max(1, parsePositiveInt(request.nextUrl.searchParams.get('limit'), DEFAULT_PAGE_SIZE)))
  const offset = parsePositiveInt(request.nextUrl.searchParams.get('offset'), 0)

  const rows = db
    .select({
      id: documents.id,
      title: documents.title,
      folderId: documents.folderId,
      createdAt: documents.createdAt,
      updatedAt: documents.updatedAt,
    })
    .from(documents)
    .where(and(...conditions))
    .orderBy(desc(documents.updatedAt))
    .limit(limit)
    .offset(offset)
    .all()

  const hasMore = rows.length === limit
  const nextOffset = hasMore ? String(offset + rows.length) : ''
  return NextResponse.json(rows, {
    headers: {
      'x-collabmd-next-offset': nextOffset,
    },
  })
}
