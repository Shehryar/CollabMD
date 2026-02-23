import { test as base, type Page, type BrowserContext } from '@playwright/test'
import crypto from 'crypto'
import {
  createTestUser,
  createTestOrg,
  createTestSession,
  addOrgMember,
} from '../helpers/db'
import { grantDocAccess, grantOrgMembership, setDocOrg } from '../helpers/openfga'

const BETTER_AUTH_SECRET = 'e2e-test-secret'

/**
 * Better Auth signs session cookies with HMAC-SHA256.
 * Cookie value format: encodeURIComponent(`${token}.${base64_signature}`)
 */
function signSessionToken(token: string): string {
  const signature = crypto
    .createHmac('sha256', BETTER_AUTH_SECRET)
    .update(token)
    .digest('base64')
  return encodeURIComponent(`${token}.${signature}`)
}

type TestUser = { id: string; name: string; email: string }
type TestOrg = { id: string; name: string; slug: string }

interface AuthenticatedContext {
  page: Page
  user: TestUser
  org: TestOrg
  context: BrowserContext
}

interface AuthFixtures {
  testUser: TestUser
  testOrg: TestOrg
  authenticatedPage: Page
  createAuthenticatedContext: (opts?: {
    name?: string
    email?: string
    orgId?: string
    orgName?: string
  }) => Promise<AuthenticatedContext>
}

export const test = base.extend<AuthFixtures>({
  testUser: async ({}, use) => {
    const user = createTestUser()
    await use(user)
  },

  testOrg: async ({ testUser }, use) => {
    const org = createTestOrg(testUser.id)
    await grantOrgMembership(testUser.id, 'member', org.id)
    await use(org)
  },

  authenticatedPage: async ({ testUser, testOrg, browser }, use) => {
    const session = createTestSession(testUser.id, testOrg.id)
    const context = await browser.newContext()
    await context.addCookies([
      {
        name: 'better-auth.session_token',
        value: signSessionToken(session.token),
        domain: 'localhost',
        path: '/',
      },
    ])
    const page = await context.newPage()
    await use(page)
    await context.close()
  },

  createAuthenticatedContext: async ({ browser, testOrg }, use) => {
    const contexts: BrowserContext[] = []

    const factory = async (opts?: {
      name?: string
      email?: string
      orgId?: string
      orgName?: string
    }): Promise<AuthenticatedContext> => {
      const user = createTestUser({ name: opts?.name, email: opts?.email })
      const orgId = opts?.orgId ?? testOrg.id

      // Add user to org
      addOrgMember(orgId, user.id, 'member')
      await grantOrgMembership(user.id, 'member', orgId)

      const session = createTestSession(user.id, orgId)
      const context = await browser.newContext()
      await context.addCookies([
        {
          name: 'better-auth.session_token',
          value: signSessionToken(session.token),
          domain: 'localhost',
          path: '/',
        },
      ])
      contexts.push(context)

      const page = await context.newPage()
      return { page, user, org: testOrg, context }
    }

    await use(factory)

    // Cleanup all created contexts
    for (const ctx of contexts) {
      await ctx.close()
    }
  },
})

export { expect } from '@playwright/test'

// Re-export FGA helpers for convenience
export { grantDocAccess, grantOrgMembership, setDocOrg }
