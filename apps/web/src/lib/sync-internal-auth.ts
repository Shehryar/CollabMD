const INTERNAL_AUTH_HEADER = 'x-collabmd-internal-secret'
const DEV_FALLBACK_SECRET = 'collabmd-dev-sync-secret'

function getInternalSecret(): string {
  const configured = process.env.SYNC_SERVER_INTERNAL_SECRET?.trim()
  if (configured) return configured

  const fallback = process.env.BETTER_AUTH_SECRET?.trim()
  if (fallback) return fallback

  if (process.env.NODE_ENV !== 'production') {
    return DEV_FALLBACK_SECRET
  }

  throw new Error('SYNC_SERVER_INTERNAL_SECRET or BETTER_AUTH_SECRET is required')
}

export function getSyncInternalHeaders(
  init?: HeadersInit,
): Headers {
  const headers = new Headers(init)
  headers.set(INTERNAL_AUTH_HEADER, getInternalSecret())
  return headers
}

export { INTERNAL_AUTH_HEADER }
