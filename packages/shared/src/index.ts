export type DocumentId = string
export type UserId = string
export type OrgId = string
export type FolderId = string

export { defineConfig, defaultConfig } from './config.js'
export type {
  CollabMDConfig,
  EmailProvider,
  StorageProvider,
  DatabaseConfig,
  PermissionsConfig,
} from './config.js'

export * from './fga/index.js'

export { fonts, colors, radii, shadows, typeScale, cssVariables } from './design-system.js'
