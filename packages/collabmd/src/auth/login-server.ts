import { createServer } from 'http'
import type { IncomingMessage, ServerResponse } from 'http'

export interface LoginResult {
  code: string
  state: string
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
): {
  code: string | null
  state: string | null
} {
  // Legacy GET flow uses query params.
  if (req.method === 'GET') {
    const url = new URL(req.url ?? '/', 'http://localhost')
    return {
      code: url.searchParams.get('code'),
      state: url.searchParams.get('state'),
    }
  }

  // New flow posts URL-encoded form data from browser callback page.
  const params = new URLSearchParams(body)
  return {
    code: params.get('code'),
    state: params.get('state'),
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
            const { code, state } = parseCallbackPayload(req, body)

            if (!code || !state) {
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
            resolveResult({ code, state })
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
