import { createSyncServer } from './server.js'

const PORT = parseInt(process.env.PORT ?? '4444', 10)

const { server } = createSyncServer()

server.listen(PORT, () => {
  console.log(`sync-server listening on port ${PORT}`)
})
