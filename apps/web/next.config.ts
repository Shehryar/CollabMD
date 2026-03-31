import type { NextConfig } from 'next'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

const nextConfig: NextConfig = {
  transpilePackages: ['@collabmd/shared'],
  serverExternalPackages: ['better-sqlite3', '@collabmd/db', 'postgres'],
  outputFileTracingRoot: path.join(__dirname, '../../'),
  distDir: process.env.NEXT_DIST_DIR ?? '.next',
  ...(process.env.DOCKER_BUILD === '1' && { output: 'standalone' }),
}

export default nextConfig
