#!/usr/bin/env node

import { Command } from 'commander'
import { Daemon } from '../daemon/index.js'

const program = new Command()

program
  .name('collabmd')
  .description('Collaborative markdown editing CLI')
  .version('0.0.0')

program
  .command('dev')
  .description('Start local dev server with editor UI')
  .option('-p, --port <port>', 'Port for the daemon HTTP API', '4200')
  .option('-d, --dir <dir>', 'Working directory', process.cwd())
  .action(async (opts: { port: string; dir: string }) => {
    const daemon = new Daemon({
      port: parseInt(opts.port, 10),
      workDir: opts.dir,
    })

    process.on('SIGINT', async () => {
      await daemon.stop()
      process.exit(0)
    })
    process.on('SIGTERM', async () => {
      await daemon.stop()
      process.exit(0)
    })

    await daemon.start()
    console.log(`collabmd dev running on http://localhost:${daemon.getPort()}`)
    console.log(`watching ${daemon.getWorkDir()}`)
    console.log('press ctrl+c to stop')
  })

program
  .command('status')
  .description('Show daemon status')
  .option('-p, --port <port>', 'Daemon port', '4200')
  .action(async (opts: { port: string }) => {
    try {
      const res = await fetch(`http://localhost:${opts.port}/status`)
      const data = await res.json()
      console.log(JSON.stringify(data, null, 2))
    } catch {
      console.log('daemon is not running')
    }
  })

program
  .command('login')
  .description('Authenticate with CollabMD server')
  .action(() => {
    console.log('login: not yet implemented')
  })

program
  .command('logout')
  .description('Clear saved credentials')
  .action(() => {
    console.log('logout: not yet implemented')
  })

program
  .command('init')
  .description('Initialize CollabMD in the current directory')
  .action(() => {
    console.log('init: not yet implemented')
  })

program
  .command('link')
  .description('Connect local project to a CollabMD server')
  .argument('[server-url]', 'Server URL to link to')
  .action((_serverUrl?: string) => {
    console.log('link: not yet implemented')
  })

program.parse()
