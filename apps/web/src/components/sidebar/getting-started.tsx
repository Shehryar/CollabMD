'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useCallback, useEffect, useMemo, useState } from 'react'

const ONE_WEEK_MS = 7 * 24 * 60 * 60 * 1000

function getDismissedKey(orgId: string): string {
  return `collabmd:getting-started:dismissed:${orgId}`
}

function getFirstSeenKey(orgId: string): string {
  return `collabmd:getting-started:first-seen:${orgId}`
}

function getCliInstalledKey(orgId: string): string {
  return `collabmd:connect:cli-installed:${orgId}`
}

function getFolderLinkedKey(orgId: string): string {
  return `collabmd:connect:folder-linked:${orgId}`
}

function getOnboardingPathKey(orgId: string): string {
  return `collabmd:onboarding-path:${orgId}`
}

interface GettingStartedProps {
  orgId: string
  orgName: string
  orgSlug?: string
  docCount: number
  memberCount: number
  hasDaemonEdits: boolean
  onCreateDocument: () => Promise<void> | void
}

type OnboardingPath = 'web' | 'local'

interface ChecklistState {
  dismissed: boolean
  expired: boolean
  cliInstalled: boolean
  folderLinked: boolean
  onboardingPath: OnboardingPath
}

function readChecklistState(orgId: string, hasDaemonEdits: boolean): ChecklistState {
  const now = Date.now()
  const firstSeenKey = getFirstSeenKey(orgId)
  const dismissedKey = getDismissedKey(orgId)
  const firstSeenRaw = localStorage.getItem(firstSeenKey)
  const firstSeen = firstSeenRaw ? Number.parseInt(firstSeenRaw, 10) : now

  if (!firstSeenRaw) {
    localStorage.setItem(firstSeenKey, String(now))
  }

  const dismissed = localStorage.getItem(dismissedKey) === '1'
  const expired = Number.isFinite(firstSeen) ? now - firstSeen > ONE_WEEK_MS : false
  const cliInstalled = hasDaemonEdits || localStorage.getItem(getCliInstalledKey(orgId)) === '1'
  const folderLinked = hasDaemonEdits || localStorage.getItem(getFolderLinkedKey(orgId)) === '1'
  const onboardingPath = localStorage.getItem(getOnboardingPathKey(orgId)) === 'local' ? 'local' : 'web'

  return { dismissed, expired, cliInstalled, folderLinked, onboardingPath }
}

export function GettingStarted({
  orgId,
  orgName,
  orgSlug,
  docCount,
  memberCount,
  hasDaemonEdits,
  onCreateDocument,
}: GettingStartedProps) {
  const router = useRouter()
  const [state, setState] = useState<ChecklistState>({
    dismissed: false,
    expired: false,
    cliInstalled: false,
    folderLinked: false,
    onboardingPath: 'web',
  })
  const [creating, setCreating] = useState(false)

  const refreshState = useCallback(() => {
    setState(readChecklistState(orgId, hasDaemonEdits))
  }, [orgId, hasDaemonEdits])

  useEffect(() => {
    refreshState()
  }, [refreshState])

  useEffect(() => {
    const onStorage = () => refreshState()
    const onFocus = () => refreshState()
    window.addEventListener('storage', onStorage)
    window.addEventListener('focus', onFocus)
    return () => {
      window.removeEventListener('storage', onStorage)
      window.removeEventListener('focus', onFocus)
    }
  }, [refreshState])

  const workspaceNamed = useMemo(() => {
    return !/^.+['’]s Workspace$/.test(orgName.trim())
  }, [orgName])

  const visible = !state.dismissed && !state.expired
  const checklistItems = state.onboardingPath === 'local'
    ? [
      {
        id: 'cli',
        label: 'Install the CLI',
        checked: state.cliInstalled,
        action: () => router.push('/connect'),
        href: '/connect',
      },
      {
        id: 'auth',
        label: 'Authenticate',
        checked: state.cliInstalled,
        action: () => router.push('/connect'),
        href: '/connect',
      },
      {
        id: 'folder',
        label: 'Link a local folder',
        checked: state.folderLinked,
        action: () => router.push('/connect'),
        href: '/connect',
      },
      {
        id: 'workspace',
        label: 'Name your workspace',
        checked: workspaceNamed,
        action: () => {
          if (orgSlug) {
            router.push(`/org/${orgSlug}/settings`)
          }
        },
        href: orgSlug ? `/org/${orgSlug}/settings` : null,
      },
    ]
    : [
      {
        id: 'workspace',
        label: 'Name your workspace',
        checked: workspaceNamed,
        action: () => {
          if (orgSlug) {
            router.push(`/org/${orgSlug}/settings`)
          }
        },
        href: orgSlug ? `/org/${orgSlug}/settings` : null,
      },
      {
        id: 'doc',
        label: 'Create your first document',
        checked: docCount > 0,
        action: async () => {
          if (creating) return
          setCreating(true)
          try {
            await onCreateDocument()
          } finally {
            setCreating(false)
          }
        },
        href: null,
      },
      {
        id: 'invite',
        label: 'Invite a teammate',
        checked: memberCount > 1,
        action: () => {
          if (orgSlug) {
            router.push(`/org/${orgSlug}/settings`)
          }
        },
        href: orgSlug ? `/org/${orgSlug}/settings` : null,
      },
    ]

  const totalCount = checklistItems.length
  const completedCount = checklistItems.filter((item) => item.checked).length
  const showWebConnectPrompt = state.onboardingPath === 'web' && completedCount === totalCount

  if (!visible && !showWebConnectPrompt) return null
  if (showWebConnectPrompt) {
    return (
      <p className="mt-3 px-[10px] font-sans text-[12.5px] text-fg-muted">
        Want to edit locally too?{' '}
        <Link href="/connect" className="text-fg hover:text-accent">
          Connect a folder
        </Link>
      </p>
    )
  }

  return (
    <section className="mt-3 rounded border border-border bg-bg px-[10px] py-2">
      <div className="mb-2 flex items-center justify-between">
        <h3 className="font-mono text-[10.5px] font-medium uppercase tracking-[0.06em] text-fg-muted">
          Getting started
        </h3>
        <button
          onClick={() => {
            localStorage.setItem(getDismissedKey(orgId), '1')
            refreshState()
          }}
          className="font-mono text-[10px] text-fg-muted hover:text-fg"
        >
          Dismiss
        </button>
      </div>

      <p className="font-mono text-[11px] text-fg-muted">{completedCount} of {totalCount} complete</p>
      <div className="mt-1 h-1.5 w-full overflow-hidden rounded bg-bg-subtle">
        <div
          className="h-full bg-accent transition-all"
          style={{ width: `${(completedCount / totalCount) * 100}%` }}
        />
      </div>

      <ul className="mt-3 space-y-1.5">
        {checklistItems.map((item) => (
          <li key={item.id} className="flex items-center gap-2">
            <span
              className={`flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-sm border ${
                item.checked ? 'border-accent bg-accent text-bg' : 'border-border bg-bg-subtle text-transparent'
              }`}
            >
              <svg className="h-2.5 w-2.5" viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M16.704 5.29a1 1 0 010 1.414l-7.25 7.25a1 1 0 01-1.414 0L3.296 9.21a1 1 0 111.414-1.414l4.037 4.036 6.543-6.542a1 1 0 011.414 0z" clipRule="evenodd" />
              </svg>
            </span>
            {item.checked ? (
              <span className="font-sans text-[12.5px] text-fg-secondary">{item.label}</span>
            ) : item.href ? (
              <Link href={item.href} className="font-sans text-[12.5px] text-fg hover:text-accent">
                {item.label}
              </Link>
            ) : (
              <button
                disabled={creating && item.id === 'doc'}
                onClick={() => {
                  void item.action()
                }}
                className="font-sans text-[12.5px] text-fg hover:text-accent disabled:opacity-50"
              >
                {item.label}
              </button>
            )}
          </li>
        ))}
      </ul>
    </section>
  )
}
