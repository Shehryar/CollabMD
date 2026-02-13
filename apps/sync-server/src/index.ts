import { createSyncServer } from './server.js'
import { verifyToken, verifySessionCookie } from './auth.js'
import { checkPermission } from '@collabmd/shared'

const PORT = parseInt(process.env.PORT ?? '4444', 10)

const { server } = createSyncServer({
  auth: process.env.BETTER_AUTH_URL ? {
    verifyToken,
    verifySessionCookie,
    checkPermission,
  } : undefined,
})

server.listen(PORT, () => {
  console.log(`sync-server listening on port ${PORT}`)
})
