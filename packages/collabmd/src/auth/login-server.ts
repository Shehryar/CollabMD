import { createServer } from 'http'
import type { IncomingMessage, ServerResponse } from 'http'

export interface LoginResult {
  token: string
  state: string
  userId: string
  email: string
  name: string
}

function readRequestBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = ''
    req.setEncoding('utf8')
    req.on('data', (chunk) => {
      data += chunk
    })
    req.on('end', () => resolve(data))
    req.on('error', reject)
  })
}

function parseCallbackPayload(
  req: IncomingMessage,
  body: string,
): { token: string | null; state: string | null; userId: string | null; email: string | null; name: string | null } {
  // Legacy GET flow uses query params.
  if (req.method === 'GET') {
    const url = new URL(req.url ?? '/', 'http://localhost')
    return {
      token: url.searchParams.get('token'),
      state: url.searchParams.get('state'),
      userId: url.searchParams.get('userId'),
      email: url.searchParams.get('email'),
      name: url.searchParams.get('name'),
    }
  }

  // New flow posts URL-encoded form data from browser callback page.
  const params = new URLSearchParams(body)
  return {
    token: params.get('token'),
    state: params.get('state'),
    userId: params.get('userId'),
    email: params.get('email'),
    name: params.get('name'),
  }
}

export function startLoginServer(
  expectedState: string,
): Promise<{ port: number; result: Promise<LoginResult> }> {
  return new Promise((resolveStart, rejectStart) => {
    const server = createServer()

    const result = new Promise<LoginResult>((resolveResult, rejectResult) => {
      const timeout = setTimeout(() => {
        server.close()
        rejectResult(new Error('Login timed out after 120 seconds'))
      }, 120_000)

      server.on('request', (req: IncomingMessage, res: ServerResponse) => {
        const url = new URL(req.url ?? '/', 'http://localhost')
        if (url.pathname !== '/callback') {
          res.writeHead(404)
          res.end('Not found')
          return
        }
        if (req.method !== 'GET' && req.method !== 'POST') {
          res.writeHead(405)
          res.end('Method not allowed')
          return
        }

        readRequestBody(req)
          .then((body) => {
            const { token, state, userId, email, name } = parseCallbackPayload(req, body)

            if (!token || !state || !userId || !email) {
              res.writeHead(400)
              res.end('Missing parameters')
              return
            }

            if (state !== expectedState) {
              res.writeHead(400)
              res.end('State mismatch')
              return
            }

            res.writeHead(200, { 'Content-Type': 'text/html' })
            res.end(
              '<html><body><h1>Login successful!</h1><p>You can close this tab.</p></body></html>',
            )

            clearTimeout(timeout)
            server.close()
            resolveResult({ token, state, userId, email, name: name ?? '' })
          })
          .catch((err) => {
            res.writeHead(400)
            res.end('Invalid callback body')
            rejectResult(err)
          })
      })
    })

    server.listen(0, '127.0.0.1', () => {
      const addr = server.address()
      if (!addr || typeof addr === 'string') {
        rejectStart(new Error('Failed to get server port'))
        return
      }
      resolveStart({ port: addr.port, result })
    })

    server.on('error', (err) => {
      rejectStart(err)
    })
  })
}
