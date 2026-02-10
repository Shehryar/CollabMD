import { betterAuth } from 'better-auth'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import { nextCookies } from 'better-auth/next-js'
import { organization } from 'better-auth/plugins'
import { magicLink } from 'better-auth/plugins'
import { jwt } from 'better-auth/plugins'
import { db } from '@collabmd/db'
import * as schema from '@collabmd/db/schema'

export const auth = betterAuth({
  baseURL: process.env.BETTER_AUTH_URL ?? 'http://localhost:3000',
  secret: process.env.BETTER_AUTH_SECRET,
  database: drizzleAdapter(db, {
    provider: 'sqlite',
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
      sendMagicLink: async ({ email, url }) => {
        console.log(`[Magic Link] Send to ${email}: ${url}`)
      },
    }),
    jwt({
      jwt: {
        issuer: process.env.BETTER_AUTH_URL ?? 'http://localhost:3000',
        audience: process.env.BETTER_AUTH_URL ?? 'http://localhost:3000',
        expirationTime: '15m',
      },
    }),
  ],
  databaseHooks: {
    user: {
      create: {
        after: async (user) => {
          const slug = (user.name ?? user.email.split('@')[0])
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, '-')
            + '-' + Math.random().toString(36).slice(2, 6)

          await auth.api.createOrganization({
            body: {
              name: `${user.name ?? 'My'}'s Workspace`,
              slug,
              userId: user.id,
            },
          })
        },
      },
    },
  },
})
