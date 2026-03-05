import { NextRequest, NextResponse } from 'next/server'

export function requireJsonContentType(request: NextRequest): NextResponse | null {
  const contentType = request.headers.get('content-type')?.toLowerCase() ?? ''
  if (contentType.includes('application/json')) return null
  return NextResponse.json({ error: 'content-type must be application/json' }, { status: 415 })
}
