import { betterAuth } from 'better-auth'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import { nextCookies } from 'better-auth/next-js'
import { organization } from 'better-auth/plugins'
import { magicLink } from 'better-auth/plugins'
import { jwt } from 'better-auth/plugins'
import { bearer } from 'better-auth/plugins'
import { db, isPostgres } from '@collabmd/db'
import * as schema from '@collabmd/db/schema'
import {
  applyPendingResourceInvitesForUser,
  applyPendingResourceInvitesForUserId,
} from '@/lib/pending-resource-invites'

if (!process.env.BETTER_AUTH_SECRET) {
  throw new Error('BETTER_AUTH_SECRET is required')
}

if (process.env.NODE_ENV === 'production' && !process.env.BETTER_AUTH_URL?.trim()) {
  throw new Error('BETTER_AUTH_URL is required in production')
}

const betterAuthUrl = process.env.BETTER_AUTH_URL?.trim() || 'http://localhost:3000'

export const auth = betterAuth({
  baseURL: betterAuthUrl,
  secret: process.env.BETTER_AUTH_SECRET,
  database: drizzleAdapter(db, {
    provider: isPostgres ? 'pg' : 'sqlite',
    schema: {
      user: schema.users,
      session: schema.sessions,
      account: schema.accounts,
      verification: schema.verifications,
      organization: schema.organizations,
      member: schema.members,
      invitation: schema.invitations,
      jwks: schema.jwks,
    },
  }),
  socialProviders: {
    google: {
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
    },
    github: {
      clientId: process.env.GITHUB_CLIENT_ID!,
      clientSecret: process.env.GITHUB_CLIENT_SECRET!,
    },
  },
  plugins: [
    nextCookies(),
    organization({
      allowUserToCreateOrganization: true,
      creatorRole: 'owner',
    }),
    magicLink({
      disableSignUp: false,
      sendMagicLink: async ({ email, url: rawUrl }) => {
        // Deduplicate callbackURL params — Better Auth can add it twice
        const parsed = new URL(rawUrl)
        const cbValues = parsed.searchParams.getAll('callbackURL')
        if (cbValues.length > 1) {
          parsed.searchParams.delete('callbackURL')
          parsed.searchParams.set('callbackURL', cbValues[0])
        }
        const url = parsed.toString()
        if (process.env.NODE_ENV === 'development') {
          console.log(`\n=== MAGIC LINK ===\nTo: ${email}\n${url}\n==================\n`)
          return
        }

        const apiKey = process.env.LOOPS_API_KEY
        const transactionalId = process.env.LOOPS_MAGIC_LINK_TRANSACTIONAL_ID
        if (!apiKey || !transactionalId) {
          console.error('Missing LOOPS_API_KEY or LOOPS_MAGIC_LINK_TRANSACTIONAL_ID')
          return
        }

        const res = await fetch('https://app.loops.so/api/v1/transactional', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${apiKey}`,
          },
          body: JSON.stringify({
            transactionalId,
            email,
            dataVariables: { magicLinkUrl: url },
          }),
        })

        if (!res.ok) {
          const body = await res.text()
          console.error(`Loops magic link email failed: ${res.status} ${body}`)
        }
      },
    }),
    jwt({
      jwt: {
        issuer: betterAuthUrl,
        audience: betterAuthUrl,
        expirationTime: '15m',
      },
    }),
    bearer(),
  ],
  databaseHooks: {
    user: {
      create: {
        after: async (user) => {
          const slug =
            (user.name ?? user.email.split('@')[0]).toLowerCase().replace(/[^a-z0-9]+/g, '-') +
            '-' +
            Math.random().toString(36).slice(2, 6)

          await auth.api.createOrganization({
            body: {
              name: `${user.name ?? 'My'}'s Workspace`,
              slug,
              userId: user.id,
            },
          })

          try {
            const result = await applyPendingResourceInvitesForUser({
              id: user.id,
              email: user.email,
            })
            if (result.failed > 0) {
              console.warn(
                `[pending-invite] partial claim during signup userId=${user.id} claimed=${result.claimed} failed=${result.failed}`,
              )
            }
          } catch (error) {
            console.error(`[pending-invite] signup claim failed userId=${user.id}`, error)
          }
        },
      },
    },
    session: {
      create: {
        after: async (session) => {
          try {
            const result = await applyPendingResourceInvitesForUserId(session.userId)
            if (result.claimed > 0 || result.failed > 0) {
              console.info(
                `[pending-invite] session claim userId=${session.userId} claimed=${result.claimed} failed=${result.failed}`,
              )
            }
          } catch (error) {
            console.error(`[pending-invite] session claim failed userId=${session.userId}`, error)
          }
        },
      },
    },
  },
})
