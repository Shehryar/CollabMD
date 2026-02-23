import { NextRequest, NextResponse } from 'next/server'
import { headers } from 'next/headers'
import { auth } from '@/lib/auth'
import { db, webhooks, webhookDeliveries, members, and, eq, desc } from '@collabmd/db'

async function requireOrgAdmin(orgId: string): Promise<true | NextResponse> {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const membership = db
    .select()
    .from(members)
    .where(and(eq(members.organizationId, orgId), eq(members.userId, session.user.id)))
    .get()

  if (!membership) {
    return NextResponse.json({ error: 'not a member of this organization' }, { status: 403 })
  }
  if (membership.role !== 'admin' && membership.role !== 'owner') {
    return NextResponse.json({ error: 'only admins and owners can view webhook deliveries' }, { status: 403 })
  }

  return true
}

function safeJsonParse(value: string): unknown {
  try {
    return JSON.parse(value)
  } catch {
    return value
  }
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ orgId: string; webhookId: string }> },
) {
  const { orgId, webhookId } = await params
  const authz = await requireOrgAdmin(orgId)
  if (authz !== true) return authz

  const webhook = db
    .select()
    .from(webhooks)
    .where(and(eq(webhooks.id, webhookId), eq(webhooks.orgId, orgId)))
    .get()
  if (!webhook) {
    return NextResponse.json({ error: 'webhook not found' }, { status: 404 })
  }

  const deliveries = db
    .select()
    .from(webhookDeliveries)
    .where(eq(webhookDeliveries.webhookId, webhookId))
    .orderBy(desc(webhookDeliveries.lastAttemptAt))
    .limit(200)
    .all()

  return NextResponse.json(deliveries.map((delivery) => ({
    id: delivery.id,
    webhookId: delivery.webhookId,
    eventType: delivery.eventType,
    payload: safeJsonParse(delivery.payload),
    statusCode: delivery.statusCode,
    responseBody: delivery.responseBody,
    attemptCount: delivery.attemptCount,
    lastAttemptAt: delivery.lastAttemptAt.toISOString(),
    createdAt: delivery.createdAt.toISOString(),
  })))
}
