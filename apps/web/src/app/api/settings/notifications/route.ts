import { NextRequest, NextResponse } from 'next/server'
import { headers } from 'next/headers'
import { auth } from '@/lib/auth'
import { requireJsonContentType } from '@/lib/http'
import { enforceUserMutationRateLimit, getClientIp } from '@/lib/rate-limit'
import {
  getUserEmailNotificationPreference,
  setUserEmailNotificationPreference,
} from '@collabmd/db'
import { isEmailNotificationPreference } from '@collabmd/shared'

export async function GET(_request: NextRequest) {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  return NextResponse.json({
    emailNotifications: getUserEmailNotificationPreference(session.user.id),
  })
}

export async function PATCH(request: NextRequest) {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const rateLimitError = enforceUserMutationRateLimit(session.user.id, { ip: getClientIp(request) })
  if (rateLimitError) return rateLimitError

  const contentTypeError = requireJsonContentType(request)
  if (contentTypeError) return contentTypeError

  const body = (await request.json()) as { emailNotifications?: unknown }
  if (!isEmailNotificationPreference(body.emailNotifications)) {
    return NextResponse.json(
      { error: 'invalid emailNotifications; must be one of: all, mentions, none' },
      { status: 400 },
    )
  }

  return NextResponse.json({
    emailNotifications: setUserEmailNotificationPreference(session.user.id, body.emailNotifications),
  })
}
