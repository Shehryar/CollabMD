import { createAuthClient } from 'better-auth/react'
import { organizationClient } from 'better-auth/client/plugins'
import { magicLinkClient } from 'better-auth/client/plugins'
import { jwtClient } from 'better-auth/client/plugins'

export const authClient = createAuthClient({
  plugins: [organizationClient(), magicLinkClient(), jwtClient()],
})

export const { signIn, signUp, signOut, useSession, useActiveOrganization, useListOrganizations } =
  authClient
