import { defineConfig } from '@playwright/test'
import path from 'path'

const webPort = 3001
const syncPort = 4445
const fgaHttpPort = 8082

const testDbPath = path.join(__dirname, '..', 'apps', 'web', 'test.db')

// Build a clean env for the sync server with BETTER_AUTH_URL removed.
// The sync server's auth.ts creates a URL at module scope from BETTER_AUTH_URL;
// setting it empty crashes, and any truthy value enables auth (which requires
// the web server to be fully compiled for session verification callbacks).
// Removing it entirely makes the sync server fall back to its default
// ('http://localhost:3000', a valid URL) but auth is disabled because
// index.ts checks `process.env.BETTER_AUTH_URL ? {...} : undefined`.
const syncEnv = { ...process.env } as Record<string, string | undefined>
delete syncEnv.BETTER_AUTH_URL
delete syncEnv.BETTER_AUTH_SECRET

export default defineConfig({
  testDir: './tests',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: process.env.CI ? 'html' : 'list',
  timeout: 60_000,

  use: {
    baseURL: `http://localhost:${webPort}`,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },

  projects: [
    {
      name: 'chromium',
      use: { browserName: 'chromium' },
    },
  ],

  globalSetup: './global-setup.ts',
  globalTeardown: './global-teardown.ts',

  webServer: [
    {
      command: `npx next dev -p ${webPort}`,
      cwd: path.join(__dirname, '..', 'apps', 'web'),
      port: webPort,
      reuseExistingServer: !process.env.CI,
      env: {
        ...process.env,
        DATABASE_URL: `file:${testDbPath}`,
        BETTER_AUTH_SECRET: 'e2e-test-secret',
        BETTER_AUTH_URL: `http://localhost:${webPort}`,
        OPENFGA_URL: `http://localhost:${fgaHttpPort}`,
        NEXT_PUBLIC_SYNC_URL: `ws://localhost:${syncPort}`,
        NEXT_DIST_DIR: '.next-e2e',
      },
      timeout: 120_000,
    },
    {
      command: `npx tsx apps/sync-server/src/index.ts`,
      cwd: path.join(__dirname, '..'),
      port: syncPort,
      reuseExistingServer: !process.env.CI,
      env: {
        ...syncEnv,
        PORT: String(syncPort),
        DATABASE_URL: `file:${testDbPath}`,
        OPENFGA_URL: `http://localhost:${fgaHttpPort}`,
      },
      timeout: 60_000,
    },
  ],
})
