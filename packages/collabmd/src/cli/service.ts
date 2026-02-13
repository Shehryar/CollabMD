import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { homedir, platform } from 'os'
import { join } from 'path'
import { spawnSync } from 'child_process'

function serviceCommandArgs(): string {
  const cliPath = process.argv[1]
  return `${process.execPath} ${cliPath} daemon --background`
}

function macServicePath(): string {
  return join(homedir(), 'Library', 'LaunchAgents', 'dev.collabmd.daemon.plist')
}

function linuxServicePath(): string {
  return join(homedir(), '.config', 'systemd', 'user', 'collabmd.service')
}

function daemonLogPath(): string {
  return join(homedir(), '.collabmd', 'daemon.log')
}

export function serviceInstallCommand(): void {
  const logPath = daemonLogPath()
  mkdirSync(join(homedir(), '.collabmd'), { recursive: true })

  if (platform() === 'darwin') {
    const target = macServicePath()
    mkdirSync(join(homedir(), 'Library', 'LaunchAgents'), { recursive: true })
    const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>dev.collabmd.daemon</string>
  <key>ProgramArguments</key>
  <array>
    <string>${process.execPath}</string>
    <string>${process.argv[1]}</string>
    <string>daemon</string>
    <string>--background</string>
  </array>
  <key>KeepAlive</key>
  <true/>
  <key>RunAtLoad</key>
  <true/>
  <key>StandardOutPath</key>
  <string>${logPath}</string>
  <key>StandardErrorPath</key>
  <string>${logPath}</string>
</dict>
</plist>
`
    writeFileSync(target, plist)
    console.log(`Installed LaunchAgent at ${target}`)
    console.log(`Start with: launchctl load -w ${target}`)
    console.log('Check with: launchctl list | grep collabmd')
    return
  }

  if (platform() === 'linux') {
    const target = linuxServicePath()
    mkdirSync(join(homedir(), '.config', 'systemd', 'user'), { recursive: true })
    const service = `[Unit]
Description=CollabMD Global Daemon
After=network-online.target

[Service]
Type=simple
ExecStart=${serviceCommandArgs()}
Restart=on-failure
StandardOutput=append:${logPath}
StandardError=append:${logPath}

[Install]
WantedBy=default.target
`
    writeFileSync(target, service)
    console.log(`Installed systemd user service at ${target}`)
    console.log('Start with: systemctl --user daemon-reload && systemctl --user enable --now collabmd.service')
    console.log('Check with: systemctl --user status collabmd.service')
    return
  }

  console.log('Service install is currently supported on macOS and Linux only.')
}

export function serviceUninstallCommand(): void {
  if (platform() === 'darwin') {
    const target = macServicePath()
    if (existsSync(target)) rmSync(target)
    spawnSync('launchctl', ['remove', 'dev.collabmd.daemon'], { stdio: 'ignore' })
    console.log('Uninstalled LaunchAgent')
    return
  }

  if (platform() === 'linux') {
    const target = linuxServicePath()
    spawnSync('systemctl', ['--user', 'disable', '--now', 'collabmd.service'], { stdio: 'ignore' })
    if (existsSync(target)) rmSync(target)
    spawnSync('systemctl', ['--user', 'daemon-reload'], { stdio: 'ignore' })
    console.log('Uninstalled systemd service')
    return
  }

  console.log('Service uninstall is currently supported on macOS and Linux only.')
}

export function serviceStatusCommand(): void {
  if (platform() === 'darwin') {
    const result = spawnSync('launchctl', ['list', 'dev.collabmd.daemon'], { encoding: 'utf-8' })
    if (result.status === 0) {
      console.log('running (launchd)')
      if (result.stdout.trim()) console.log(result.stdout.trim())
    } else {
      console.log('stopped (launchd)')
    }
    return
  }

  if (platform() === 'linux') {
    const result = spawnSync('systemctl', ['--user', 'status', 'collabmd.service', '--no-pager'], { encoding: 'utf-8' })
    if (result.status === 0) {
      console.log('running (systemd)')
      console.log(result.stdout.trim())
    } else {
      console.log('stopped (systemd)')
      if (result.stdout.trim()) console.log(result.stdout.trim())
    }
    return
  }

  const log = daemonLogPath()
  console.log('Service status is currently supported on macOS and Linux only.')
  if (existsSync(log)) {
    const tail = readFileSync(log, 'utf-8').split('\n').slice(-10).join('\n')
    console.log(tail)
  }
}

export function serviceControlCommand(action: 'start' | 'stop' | 'restart'): void {
  if (platform() === 'darwin') {
    const target = macServicePath()
    if (action === 'start') {
      spawnSync('launchctl', ['load', '-w', target], { stdio: 'inherit' })
    } else if (action === 'stop') {
      spawnSync('launchctl', ['unload', '-w', target], { stdio: 'inherit' })
    } else {
      spawnSync('launchctl', ['unload', '-w', target], { stdio: 'inherit' })
      spawnSync('launchctl', ['load', '-w', target], { stdio: 'inherit' })
    }
    return
  }

  if (platform() === 'linux') {
    spawnSync('systemctl', ['--user', action, 'collabmd.service'], { stdio: 'inherit' })
    return
  }

  console.log(`Service ${action} is currently supported on macOS and Linux only.`)
}

