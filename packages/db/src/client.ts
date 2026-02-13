import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import * as schema from './schema.js'

type DbInstance = ReturnType<typeof drizzle<typeof schema>>

let dbInstance: DbInstance | null = null

export function getDb(): DbInstance {
  if (dbInstance) return dbInstance

  const sqlite = new Database(process.env.DATABASE_URL ?? 'local.db')
  sqlite.pragma('journal_mode = WAL')
  sqlite.pragma('foreign_keys = ON')

  dbInstance = drizzle(sqlite, { schema })
  return dbInstance
}

export const db: DbInstance = new Proxy({} as DbInstance, {
  get(_target, prop, receiver) {
    const instance = getDb()
    const value = Reflect.get(instance, prop, receiver)
    return typeof value === 'function' ? value.bind(instance) : value
  },
})
