// ─── Provider interfaces ───

export interface EmailProvider {
  name: string
  send(to: string, subject: string, html: string): Promise<void>
}

export interface StorageProvider {
  name: string
  read(key: string): Promise<Buffer | null>
  write(key: string, data: Buffer): Promise<void>
  delete(key: string): Promise<void>
}

export interface DatabaseConfig {
  engine: 'sqlite' | 'postgres'
  url: string
}

export interface PermissionsConfig {
  engine: 'openfga'
  url: string
}

// ─── Config schema ───

export interface CollabMDConfig {
  server?: string

  database?: DatabaseConfig

  auth?: {
    providers?: ('magic-link' | 'google' | 'github')[]
    secret?: string
  }

  permissions?: PermissionsConfig

  email?: EmailProvider | { provider: 'console' } | { provider: 'resend'; apiKey: string }

  storage?: { provider: 'local'; path: string } | { provider: 's3'; bucket: string; region: string }
}

// ─── Defaults (zero-config local dev) ───

export const defaultConfig: Required<Pick<CollabMDConfig, 'server' | 'database' | 'permissions'>> &
  CollabMDConfig = {
  server: 'http://localhost:3000',
  database: {
    engine: 'sqlite',
    url: 'file:./local.db',
  },
  permissions: {
    engine: 'openfga',
    url: 'http://localhost:8081',
  },
  email: { provider: 'console' },
  storage: { provider: 'local', path: './.collabmd/storage' },
}

// ─── defineConfig helper ───

export function defineConfig(
  config: CollabMDConfig = {},
): Required<Pick<CollabMDConfig, 'server' | 'database' | 'permissions'>> & CollabMDConfig {
  return {
    ...defaultConfig,
    ...config,
    database: config.database ?? defaultConfig.database,
    permissions: config.permissions ?? defaultConfig.permissions,
  }
}
