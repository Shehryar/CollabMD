import { lookup } from 'node:dns/promises'
import { isIP } from 'node:net'

function isSingleLabelHostname(hostname: string): boolean {
  return !hostname.includes('.')
}

function isPrivateIpv4(address: string): boolean {
  const parts = address.split('.').map((part) => Number.parseInt(part, 10))
  if (parts.length !== 4 || parts.some((part) => Number.isNaN(part) || part < 0 || part > 255)) {
    return true
  }

  const [a, b] = parts
  if (a === 0 || a === 10 || a === 127) return true
  if (a === 169 && b === 254) return true
  if (a === 172 && b >= 16 && b <= 31) return true
  if (a === 192 && b === 168) return true
  if (a === 100 && b >= 64 && b <= 127) return true
  if (a === 198 && (b === 18 || b === 19)) return true
  if (a >= 224) return true
  return false
}

function isPrivateIpv6(address: string): boolean {
  const normalized = address.toLowerCase()
  if (normalized === '::' || normalized === '::1') return true
  if (normalized.startsWith('fc') || normalized.startsWith('fd')) return true
  if (
    normalized.startsWith('fe8') ||
    normalized.startsWith('fe9') ||
    normalized.startsWith('fea') ||
    normalized.startsWith('feb')
  ) {
    return true
  }

  if (normalized.startsWith('::ffff:')) {
    return isPrivateIpv4(normalized.slice('::ffff:'.length))
  }

  return false
}

function isForbiddenIpAddress(address: string): boolean {
  const family = isIP(address)
  if (family === 4) return isPrivateIpv4(address)
  if (family === 6) return isPrivateIpv6(address)
  return false
}

export async function validateOutboundWebhookUrl(rawUrl: string): Promise<URL> {
  let parsed: URL
  try {
    parsed = new URL(rawUrl)
  } catch {
    throw new Error('url must be valid')
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('url must use http or https')
  }

  if (parsed.username || parsed.password) {
    throw new Error('url must not include credentials')
  }

  const hostname = parsed.hostname.trim().toLowerCase()
  if (!hostname) {
    throw new Error('url hostname is required')
  }

  if (
    hostname === 'localhost' ||
    hostname.endsWith('.localhost') ||
    hostname === 'localdomain' ||
    hostname.endsWith('.localdomain') ||
    isSingleLabelHostname(hostname)
  ) {
    throw new Error('url hostname is not allowed')
  }

  if (isForbiddenIpAddress(hostname)) {
    throw new Error('url hostname resolves to a private or local address')
  }

  const resolved = await lookup(hostname, { all: true, verbatim: true })
  if (resolved.length === 0) {
    throw new Error('url hostname could not be resolved')
  }

  for (const entry of resolved) {
    if (isForbiddenIpAddress(entry.address)) {
      throw new Error('url hostname resolves to a private or local address')
    }
  }

  return parsed
}
