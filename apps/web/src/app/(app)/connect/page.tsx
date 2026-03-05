'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useSession } from '@/lib/auth-client'
import { useSidebar } from '@/components/sidebar/sidebar-context'

type Platform = 'macos' | 'linux' | 'windows'

function detectPlatform(userAgent: string): Platform {
  const ua = userAgent.toLowerCase()
  if (ua.includes('mac')) return 'macos'
  if (ua.includes('win')) return 'windows'
  return 'linux'
}

function cliInstalledKey(orgId: string): string {
  return `collabmd:connect:cli-installed:${orgId}`
}

function folderLinkedKey(orgId: string): string {
  return `collabmd:connect:folder-linked:${orgId}`
}

function CommandBlock({ command, onCopied }: { command: string; onCopied: () => void }) {
  return (
    <div className="mt-2 flex items-center gap-2 rounded border border-border bg-bg-subtle px-3 py-2">
      <code className="min-w-0 flex-1 overflow-x-auto whitespace-nowrap font-mono text-[12px] text-fg">
        {command}
      </code>
      <button
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(command)
            onCopied()
          } catch {
            // Ignore clipboard errors.
          }
        }}
        className="shrink-0 rounded border border-border bg-bg px-2 py-1 font-mono text-[10px] text-fg-secondary hover:text-fg"
      >
        Copy
      </button>
    </div>
  )
}

export default function ConnectPage() {
  const router = useRouter()
  const { data: session } = useSession()
  const { onboardingStatus, refreshOnboardingStatus } = useSidebar()
  const orgId = onboardingStatus?.orgId ?? session?.session?.activeOrganizationId ?? null
  const [platform, setPlatform] = useState<Platform>('macos')
  const [tab, setTab] = useState<Platform>('macos')
  const [origin, setOrigin] = useState('http://localhost:3000')
  const [copiedMessage, setCopiedMessage] = useState('')
  const [cliInstalled, setCliInstalled] = useState(false)
  const [cliAuthenticated, setCliAuthenticated] = useState(false)
  const [folderLinked, setFolderLinked] = useState(false)
  const [daemonConnected, setDaemonConnected] = useState(false)
  const [folders, setFolders] = useState<Array<{ id?: string; path?: string; fileCount?: number }>>(
    [],
  )

  useEffect(() => {
    const detected = detectPlatform(navigator.userAgent)
    setPlatform(detected)
    setTab(detected)
    setOrigin(window.location.origin)
  }, [])

  useEffect(() => {
    if (!orgId) return
    const storedCliInstalled = localStorage.getItem(cliInstalledKey(orgId)) === '1'
    const storedFolderLinked = localStorage.getItem(folderLinkedKey(orgId)) === '1'
    setCliInstalled(storedCliInstalled)
    setFolderLinked(storedFolderLinked)
  }, [orgId])

  useEffect(() => {
    const timer = setTimeout(() => setCopiedMessage(''), 1500)
    return () => clearTimeout(timer)
  }, [copiedMessage])

  useEffect(() => {
    let cancelled = false

    async function pollStatus() {
      const qs = orgId ? `?orgId=${encodeURIComponent(orgId)}` : ''
      try {
        const res = await fetch(`/api/connect/status${qs}`, { cache: 'no-store' })
        if (!res.ok) return
        const status = (await res.json()) as { cliAuthenticated: boolean; daemonConnected: boolean }
        if (cancelled) return

        setCliAuthenticated(status.cliAuthenticated)
        setDaemonConnected(status.daemonConnected)

        if (orgId && status.cliAuthenticated) {
          localStorage.setItem(cliInstalledKey(orgId), '1')
          setCliInstalled(true)
        }

        if (orgId && status.daemonConnected) {
          localStorage.setItem(folderLinkedKey(orgId), '1')
          setFolderLinked(true)
          void refreshOnboardingStatus()
        }
      } catch {
        // Keep polling quietly.
      }
    }

    void pollStatus()
    const interval = setInterval(() => {
      void pollStatus()
    }, 3000)

    return () => {
      cancelled = true
      clearInterval(interval)
    }
  }, [orgId, refreshOnboardingStatus])

  useEffect(() => {
    let cancelled = false
    async function loadFolders() {
      try {
        const res = await fetch('/api/connect/folders')
        if (!res.ok) return
        const data = (await res.json()) as Array<{ id?: string; path?: string; fileCount?: number }>
        if (!cancelled) setFolders(data)
      } catch {
        // Ignore while sync-server integration is pending.
      }
    }
    void loadFolders()
    return () => {
      cancelled = true
    }
  }, [])

  const installCommand = useMemo(() => {
    if (tab === 'macos') return 'brew install collabmd'
    return 'npm i -g collabmd'
  }, [tab])

  const loginCommand = 'collabmd login'
  const linkCommand = `collabmd link ${origin}`
  const devCommand = 'collabmd dev'
  const serviceCommand = 'collabmd service install'
  const oneCommand = `npm i -g collabmd && ${loginCommand} && ${linkCommand} && ${devCommand}`

  const isStep1Done = cliInstalled
  const isStep2Done = cliAuthenticated
  const isStep3Done = folderLinked || daemonConnected
  const activeStep = !isStep1Done ? 1 : !isStep2Done ? 2 : !isStep3Done ? 3 : 4

  const stepCircleClass = (step: number) => {
    if (step < activeStep) return 'border-accent bg-accent text-bg'
    if (step === activeStep) return 'border-accent text-accent'
    return 'border-border text-fg-muted'
  }

  return (
    <div className="mx-auto w-full max-w-4xl px-4 py-8 sm:px-6">
      <h1 className="font-mono text-[18px] font-semibold tracking-[-0.03em] text-fg">
        Connect local folder
      </h1>
      <p className="mt-1 font-sans text-sm text-fg-secondary">
        Install the CLI, authenticate, and link a folder to sync markdown files into CollabMD.
      </p>

      <div className="mt-4">
        <p className="font-mono text-[10.5px] font-medium uppercase tracking-[0.06em] text-fg-muted">
          One-command shortcut
        </p>
        <CommandBlock
          command={oneCommand}
          onCopied={() => setCopiedMessage('Copied shortcut command')}
        />
      </div>

      {copiedMessage && <p className="mt-2 font-mono text-[11px] text-green">{copiedMessage}</p>}

      <div className="mt-6 space-y-4">
        <section className="rounded border border-border bg-bg p-4">
          <div className="flex items-start gap-3">
            <span
              className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border font-mono text-[11px] ${stepCircleClass(1)}`}
            >
              1
            </span>
            <div className="min-w-0 flex-1">
              <h2 className="font-mono text-[13px] text-fg">Install CLI</h2>
              <div className="mt-2 flex items-center gap-1">
                {(['macos', 'linux', 'windows'] as const).map((option) => (
                  <button
                    key={option}
                    onClick={() => setTab(option)}
                    className={`rounded border px-2 py-1 font-mono text-[10px] uppercase ${
                      tab === option ? 'border-fg text-fg' : 'border-border text-fg-muted'
                    }`}
                  >
                    {option}
                  </button>
                ))}
              </div>
              <CommandBlock
                command={installCommand}
                onCopied={() => setCopiedMessage('Copied install command')}
              />
              <button
                onClick={() => {
                  if (!orgId) return
                  localStorage.setItem(cliInstalledKey(orgId), '1')
                  setCliInstalled(true)
                }}
                className="mt-2 font-mono text-[11px] text-fg-muted hover:text-fg"
              >
                Already installed? Skip
              </button>
            </div>
          </div>
        </section>

        <section className="rounded border border-border bg-bg p-4">
          <div className="flex items-start gap-3">
            <span
              className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border font-mono text-[11px] ${stepCircleClass(2)}`}
            >
              2
            </span>
            <div className="min-w-0 flex-1">
              <h2 className="font-mono text-[13px] text-fg">Authenticate</h2>
              <p className="mt-1 font-sans text-xs text-fg-muted">
                Run this command and complete the browser callback.
              </p>
              <CommandBlock
                command={loginCommand}
                onCopied={() => setCopiedMessage('Copied login command')}
              />
              <p
                className={`mt-2 font-mono text-[11px] ${cliAuthenticated ? 'text-green' : 'text-fg-muted'}`}
              >
                {cliAuthenticated
                  ? 'Authenticated via CLI callback.'
                  : 'Waiting for CLI authentication...'}
              </p>
            </div>
          </div>
        </section>

        <section className="rounded border border-border bg-bg p-4">
          <div className="flex items-start gap-3">
            <span
              className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border font-mono text-[11px] ${stepCircleClass(3)}`}
            >
              3
            </span>
            <div className="min-w-0 flex-1">
              <h2 className="font-mono text-[13px] text-fg">Link a folder</h2>
              <CommandBlock
                command={linkCommand}
                onCopied={() => setCopiedMessage('Copied link command')}
              />
              <CommandBlock
                command={devCommand}
                onCopied={() => setCopiedMessage('Copied dev command')}
              />
              <p
                className={`mt-2 font-mono text-[11px] ${isStep3Done ? 'text-green' : 'text-fg-muted'}`}
              >
                {isStep3Done
                  ? 'Daemon connection detected.'
                  : 'Waiting for daemon sync connection...'}
              </p>
              {!isStep3Done && orgId && (
                <button
                  onClick={() => {
                    localStorage.setItem(folderLinkedKey(orgId), '1')
                    setFolderLinked(true)
                    void refreshOnboardingStatus()
                  }}
                  className="mt-2 font-mono text-[11px] text-fg-muted hover:text-fg"
                >
                  Mark as connected
                </button>
              )}
            </div>
          </div>
        </section>

        <section className="rounded border border-border bg-bg p-4">
          <div className="flex items-start gap-3">
            <span
              className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border font-mono text-[11px] ${stepCircleClass(4)}`}
            >
              4
            </span>
            <div className="min-w-0 flex-1">
              <h2 className="font-mono text-[13px] text-fg">Success</h2>
              <p className="mt-1 font-sans text-xs text-fg-muted">
                Keep the daemon running, or install it as a background service.
              </p>
              <CommandBlock
                command={serviceCommand}
                onCopied={() => setCopiedMessage('Copied service command')}
              />
              {folders.length > 0 ? (
                <ul className="mt-2 space-y-1 font-mono text-[11px] text-fg-secondary">
                  {folders.map((folder, idx) => (
                    <li key={folder.id ?? String(idx)}>
                      {folder.path ?? 'Connected folder'}{' '}
                      {folder.fileCount !== undefined ? `(${folder.fileCount} files)` : ''}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-2 font-mono text-[11px] text-fg-muted">
                  Folder metadata will appear once sync-server integration is enabled.
                </p>
              )}
              <button
                onClick={() => router.push('/')}
                className="mt-3 rounded bg-fg px-4 py-[7px] font-mono text-[12.5px] font-medium text-bg"
              >
                Go to documents
              </button>
            </div>
          </div>
        </section>
      </div>

      {platform === 'windows' && (
        <p className="mt-4 font-mono text-[11px] text-fg-muted">
          Tip: use PowerShell when running the commands above.
        </p>
      )}
    </div>
  )
}
