import type { NextConfig } from 'next'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

const securityHeaders = [
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
  {
    key: 'Content-Security-Policy',
    value: [
      "default-src 'self'",
      "base-uri 'self'",
      "frame-ancestors 'none'",
      "form-action 'self' http://127.0.0.1:* http://localhost:*",
      "img-src 'self' data: blob: https:",
      "font-src 'self' data:",
      "style-src 'self' 'unsafe-inline'",
      "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
      "connect-src 'self' https: wss: ws:",
      "object-src 'none'",
    ].join('; '),
  },
]

const nextConfig: NextConfig = {
  transpilePackages: ['@collabmd/shared'],
  serverExternalPackages: ['better-sqlite3', '@collabmd/db', 'postgres'],
  outputFileTracingRoot: path.join(__dirname, '../../'),
  distDir: process.env.NEXT_DIST_DIR ?? '.next',
  ...(process.env.DOCKER_BUILD === '1' && { output: 'standalone' }),
  async headers() {
    return [
      {
        source: '/:path*',
        headers: securityHeaders,
      },
    ]
  },
}

export default nextConfig
