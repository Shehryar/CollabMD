import { NextRequest, NextResponse } from 'next/server'
import { headers, cookies } from 'next/headers'
import { auth } from '@/lib/auth'

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams
  const port = searchParams.get('port')
  const state = searchParams.get('state')

  if (!port || !state) {
    return NextResponse.json({ error: 'missing port or state' }, { status: 400 })
  }

  const portNum = parseInt(port, 10)
  if (isNaN(portNum) || portNum < 1024 || portNum > 65535) {
    return NextResponse.json({ error: 'invalid port' }, { status: 400 })
  }

  const session = await auth.api.getSession({ headers: await headers() })

  if (!session) {
    const callbackURL = `/api/auth/cli-callback?${searchParams.toString()}`
    return NextResponse.redirect(
      new URL(`/login?callbackURL=${encodeURIComponent(callbackURL)}`, request.url),
    )
  }

  const sessionToken = (await cookies()).get('better-auth.session_token')?.value
  if (!sessionToken) {
    return NextResponse.json({ error: 'session token not found' }, { status: 401 })
  }

  const callbackUrl = `http://127.0.0.1:${portNum}/callback`
  const formFields = {
    token: sessionToken,
    state,
    userId: session.user.id,
    email: session.user.email,
    name: session.user.name || '',
  }

  const html = `<!doctype html>
<html>
  <body>
    <p>Completing CLI login...</p>
    <form id="cli-callback" method="POST" action="${escapeHtml(callbackUrl)}">
      <input type="hidden" name="token" value="${escapeHtml(formFields.token)}" />
      <input type="hidden" name="state" value="${escapeHtml(formFields.state)}" />
      <input type="hidden" name="userId" value="${escapeHtml(formFields.userId)}" />
      <input type="hidden" name="email" value="${escapeHtml(formFields.email)}" />
      <input type="hidden" name="name" value="${escapeHtml(formFields.name)}" />
      <noscript><button type="submit">Complete login</button></noscript>
    </form>
    <script>document.getElementById('cli-callback')?.submit()</script>
  </body>
</html>`

  const response = new NextResponse(html, {
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  })

  response.cookies.set('collabmd_cli_authenticated', '1', {
    path: '/',
    sameSite: 'lax',
    httpOnly: false,
    secure: process.env.NODE_ENV === 'production',
    maxAge: 60 * 60 * 24 * 30,
  })

  return response
}
