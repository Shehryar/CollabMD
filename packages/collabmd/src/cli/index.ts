#!/usr/bin/env node

import { Command } from 'commander'
import { createWriteStream, mkdirSync } from 'fs'
import { homedir } from 'os'
import { join } from 'path'
import { Daemon, GlobalDaemon } from '../daemon/index.js'
import { loginCommand } from './login.js'
import { logoutCommand } from './logout.js'
import { linkCommand } from './link.js'
import { unlinkCommand } from './unlink.js'
import {
  serviceControlCommand,
  serviceInstallCommand,
  serviceStatusCommand,
  serviceUninstallCommand,
} from './service.js'
import { runOnboardingFlow } from './onboarding.js'
import { pushCommand } from './push.js'
import { pullCommand } from './pull.js'

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
  .command('daemon')
  .description('Start the global daemon orchestrator')
  .option('--background', 'Run background global daemon mode')
  .option('-p, --port <port>', 'Port for the daemon HTTP API', '4200')
  .action(async (opts: { background?: boolean; port: string }) => {
    if (!opts.background) {
      console.log('Use `collabmd daemon --background` for global daemon mode.')
      return
    }

    const logDir = join(homedir(), '.collabmd')
    mkdirSync(logDir, { recursive: true })
    const logPath = join(logDir, 'daemon.log')
    const logStream = createWriteStream(logPath, { flags: 'a' })

    const writeLog = (level: 'INFO' | 'ERROR', args: unknown[]) => {
      const message = args.map((arg) => (typeof arg === 'string' ? arg : JSON.stringify(arg))).join(' ')
      logStream.write(`[${new Date().toISOString()}] [${level}] ${message}\n`)
    }

    const originalLog = console.log
    const originalError = console.error
    console.log = (...args: unknown[]) => {
      writeLog('INFO', args)
      originalLog(...args)
    }
    console.error = (...args: unknown[]) => {
      writeLog('ERROR', args)
      originalError(...args)
    }

    const daemon = new GlobalDaemon({ port: parseInt(opts.port, 10) })
    const shutdown = async () => {
      await daemon.stop()
      logStream.end()
      process.exit(0)
    }

    process.on('SIGINT', () => void shutdown())
    process.on('SIGTERM', () => void shutdown())

    await daemon.start()
    console.log(`Global daemon running on http://localhost:${opts.port}`)
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
  .command('push')
  .description('Push local git commits to a remote')
  .option('--remote <name>', 'Remote name', 'origin')
  .option('--branch <name>', 'Branch name')
  .action(async (opts: { remote: string; branch?: string }) => {
    await pushCommand({
      remote: opts.remote,
      branch: opts.branch,
    })
  })

program
  .command('pull')
  .description('Fetch and merge remote changes')
  .option('--remote <name>', 'Remote name', 'origin')
  .option('--branch <name>', 'Branch name')
  .action(async (opts: { remote: string; branch?: string }) => {
    await pullCommand({
      remote: opts.remote,
      branch: opts.branch,
    })
  })

program
  .command('login')
  .description('Authenticate with CollabMD server')
  .option('-s, --server <url>', 'Server URL', 'http://localhost:3000')
  .action(async (opts: { server: string }) => {
    await loginCommand(opts.server)
  })

program
  .command('logout')
  .description('Clear saved credentials')
  .option('-s, --server <url>', 'Server URL')
  .action((opts: { server?: string }) => {
    logoutCommand(opts.server)
  })

program
  .command('init')
  .description('Run onboarding in the current directory')
  .option('-s, --server <url>', 'Server URL or "local"')
  .option('-o, --org <orgId>', 'Default organization ID')
  .option('--skip <steps>', 'Comma-separated steps to skip')
  .action(async (opts: { server?: string; org?: string; skip?: string }) => {
    const argv: string[] = []
    if (opts.skip) {
      argv.push(`--skip=${opts.skip}`)
    }
    if (opts.server) {
      argv.push('--skip=server')
    }

    await runOnboardingFlow({
      argv,
      cwdMode: true,
      rootDir: process.cwd(),
      defaultOrgId: opts.org,
      defaultServerUrl: opts.server && opts.server !== 'local' ? opts.server : undefined,
    })
  })

program
  .command('link')
  .description('Connect local project to a CollabMD server')
  .argument('[server-url]', 'Server URL to link to')
  .action((serverUrl?: string) => {
    linkCommand(serverUrl || 'http://localhost:3000')
  })

program
  .command('unlink')
  .description('Remove current folder from global daemon registry')
  .action(() => {
    unlinkCommand()
  })

const service = program.command('service').description('Manage background daemon service')

service
  .command('install')
  .description('Install background service')
  .action(() => {
    serviceInstallCommand()
  })

service
  .command('uninstall')
  .description('Uninstall background service')
  .action(() => {
    serviceUninstallCommand()
  })

service
  .command('status')
  .description('Check background service status')
  .action(() => {
    serviceStatusCommand()
  })

service
  .command('start')
  .description('Start background service')
  .action(() => {
    serviceControlCommand('start')
  })

service
  .command('stop')
  .description('Stop background service')
  .action(() => {
    serviceControlCommand('stop')
  })

service
  .command('restart')
  .description('Restart background service')
  .action(() => {
    serviceControlCommand('restart')
  })

program.parse()
