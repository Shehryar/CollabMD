'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { authClient } from '@/lib/auth-client'

type Step = 1 | 2 | 3
type OnboardingPath = 'web' | 'local'

function onboardingCompletedKey(orgId: string): string {
  return `collabmd:onboarding-completed:${orgId}`
}

function onboardingPathKey(orgId: string): string {
  return `collabmd:onboarding-path:${orgId}`
}

function parseEmails(value: string): string[] {
  return value
    .split(/[,\n]/g)
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean)
}

interface OnboardingWizardProps {
  open: boolean
  orgId: string
  orgName: string
  onClose: () => void
  onRefreshStatus: () => Promise<void>
}

export function OnboardingWizard({
  open,
  orgId,
  orgName,
  onClose,
  onRefreshStatus,
}: OnboardingWizardProps) {
  const router = useRouter()
  const [step, setStep] = useState<Step>(1)
  const [path, setPath] = useState<OnboardingPath | null>(null)
  const [name, setName] = useState(orgName)
  const [savingName, setSavingName] = useState(false)
  const [nameError, setNameError] = useState('')
  const [emailInput, setEmailInput] = useState('')
  const [emails, setEmails] = useState<string[]>([])
  const [inviteResults, setInviteResults] = useState<Record<string, 'sent' | 'error'>>({})
  const [sendingInvites, setSendingInvites] = useState(false)
  const [inviteError, setInviteError] = useState('')
  const [creatingDoc, setCreatingDoc] = useState(false)

  useEffect(() => {
    if (!open) return
    setStep(1)
    setPath(null)
    setName(orgName)
    setNameError('')
    setInviteError('')
    setEmailInput('')
    setEmails([])
    setInviteResults({})
    setSavingName(false)
    setSendingInvites(false)
    setCreatingDoc(false)
  }, [open, orgName])

  const allEmails = useMemo(() => {
    const fromInput = parseEmails(emailInput)
    return Array.from(new Set([...emails, ...fromInput]))
  }, [emails, emailInput])

  const finish = () => {
    localStorage.setItem(onboardingCompletedKey(orgId), '1')
    onClose()
  }

  const choosePath = (nextPath: OnboardingPath) => {
    setPath(nextPath)
    localStorage.setItem(onboardingPathKey(orgId), nextPath)
    window.dispatchEvent(new Event('storage'))
    setStep(2)
  }

  const finishAndGoToConnect = () => {
    finish()
    router.push('/connect')
  }

  const nextFromName = async () => {
    const trimmed = name.trim()
    setNameError('')
    if (!trimmed) {
      setNameError('Workspace name is required')
      return
    }

    if (trimmed === orgName) {
      setStep(3)
      return
    }

    setSavingName(true)
    try {
      const orgApi = authClient.organization as unknown as {
        update?: (args: { data: { name: string } }) => Promise<{ error?: { message?: string } }>
        updateOrganization?: (args: { data?: { name: string }; name?: string }) => Promise<{ error?: { message?: string } }>
      }
      if (!orgApi.update && !orgApi.updateOrganization) {
        setNameError('Organization update is unavailable')
        return
      }

      const result = orgApi.update
        ? await orgApi.update({ data: { name: trimmed } })
        : await orgApi.updateOrganization!({ name: trimmed })
      if (result.error) {
        setNameError(result.error.message ?? 'Failed to update workspace name')
        return
      }

      await onRefreshStatus()
      setStep(3)
    } catch {
      setNameError('Failed to update workspace name')
    } finally {
      setSavingName(false)
    }
  }

  const sendInvites = async () => {
    setInviteError('')
    if (allEmails.length === 0) {
      setInviteError('Add at least one email')
      return
    }

    setSendingInvites(true)
    const nextResults: Record<string, 'sent' | 'error'> = {}
    try {
      for (const email of allEmails) {
        const { error } = await authClient.organization.inviteMember({
          email,
          role: 'member',
        })
        nextResults[email] = error ? 'error' : 'sent'
      }
      setInviteResults(nextResults)
      setEmails([])
      setEmailInput('')
      await onRefreshStatus()
    } catch {
      setInviteError('Failed to send invites')
    } finally {
      setSendingInvites(false)
    }
  }

  const createDocumentAndClose = async () => {
    if (creatingDoc) return
    setCreatingDoc(true)
    try {
      const res = await fetch('/api/documents', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: 'Untitled', orgId }),
      })
      if (!res.ok) {
        return
      }
      const doc = await res.json() as { id: string }
      finish()
      router.push(`/doc/${doc.id}`)
    } finally {
      setCreatingDoc(false)
    }
  }

  if (!open) return null

  const stepIndicator = (
    <div className="mb-4 flex items-center justify-between">
      <p className="font-mono text-[11px] text-fg-muted">Step {step} of 3</p>
      <div className="flex items-center gap-1.5">
        {[1, 2, 3].map((dot) => (
          <span
            key={dot}
            className={`h-1.5 w-6 rounded-full ${dot <= step ? 'bg-accent' : 'bg-border'}`}
          />
        ))}
      </div>
    </div>
  )

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/35 p-4">
      <div className="w-full max-w-[480px] rounded border border-border bg-bg p-5 shadow">
        {stepIndicator}

        {step === 1 && (
          <div className="animate-[fade-in_150ms_ease-out]">
            <h2 className="font-mono text-[14px] font-semibold tracking-[-0.02em] text-fg">Choose your path</h2>
            <p className="mt-1 font-sans text-sm text-fg-secondary">
              Start writing in the browser or sync your local markdown files.
            </p>
            <div className="mt-4 grid grid-cols-2 gap-2">
              <button
                onClick={() => choosePath('web')}
                className="rounded border border-border bg-bg-subtle p-3 text-left hover:border-border-strong"
              >
                <p className="font-mono text-[12px] text-fg">Write in the browser</p>
                <p className="mt-1 font-sans text-xs text-fg-muted">
                  Start creating and sharing documents right now. No installation needed.
                </p>
              </button>
              <button
                onClick={() => choosePath('local')}
                className="rounded border border-border bg-bg-subtle p-3 text-left hover:border-border-strong"
              >
                <p className="font-mono text-[12px] text-fg">Sync local files</p>
                <p className="mt-1 font-sans text-xs text-fg-muted">
                  Edit .md files on your machine. CollabMD syncs them to the web for collaboration.
                </p>
              </button>
            </div>
            <div className="mt-4 flex items-center justify-between">
              <button
                onClick={finish}
                className="font-mono text-[11px] text-fg-muted hover:text-fg"
              >
                Skip
              </button>
            </div>
          </div>
        )}

        {step === 2 && (
          <div className="animate-[fade-in_150ms_ease-out]">
            <h2 className="font-mono text-[14px] font-semibold tracking-[-0.02em] text-fg">Name your workspace</h2>
            <p className="mt-1 font-sans text-sm text-fg-secondary">
              Give your team space a clear name before you start collaborating.
            </p>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  void nextFromName()
                }
              }}
              className="mt-4 w-full rounded border border-border bg-bg px-3 py-2 font-mono text-sm text-fg focus:border-fg focus:outline-none"
            />
            {nameError && <p className="mt-2 text-xs text-red">{nameError}</p>}
            <div className="mt-4 flex items-center justify-between">
              <button
                onClick={() => setStep(3)}
                className="font-mono text-[11px] text-fg-muted hover:text-fg"
              >
                Skip
              </button>
              <button
                onClick={() => {
                  void nextFromName()
                }}
                disabled={savingName}
                className="rounded bg-fg px-4 py-[7px] font-mono text-[12.5px] font-medium text-bg disabled:opacity-50"
              >
                {savingName ? 'Saving...' : 'Next'}
              </button>
            </div>
          </div>
        )}

        {step === 3 && path === 'web' && (
          <div className="animate-[fade-in_150ms_ease-out]">
            <h2 className="font-mono text-[14px] font-semibold tracking-[-0.02em] text-fg">Invite your team</h2>
            <p className="mt-1 font-sans text-sm text-fg-secondary">
              Add one or more emails, separated by commas or Enter.
            </p>
            <div className="mt-3 flex flex-wrap gap-1.5">
              {emails.map((email) => (
                <span
                  key={email}
                  className="rounded-sm border border-border bg-bg-subtle px-2 py-0.5 font-mono text-[11px] text-fg-secondary"
                >
                  {email}
                </span>
              ))}
            </div>
            <input
              value={emailInput}
              onChange={(e) => setEmailInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key !== 'Enter' && e.key !== ',') return
                e.preventDefault()
                const parsed = parseEmails(emailInput)
                if (parsed.length > 0) {
                  setEmails((prev) => Array.from(new Set([...prev, ...parsed])))
                  setEmailInput('')
                }
              }}
              placeholder="teammate@company.com"
              className="mt-2 w-full rounded border border-border bg-bg px-3 py-2 font-mono text-sm text-fg placeholder:text-fg-faint focus:border-fg focus:outline-none"
            />
            {inviteError && <p className="mt-2 text-xs text-red">{inviteError}</p>}

            {Object.keys(inviteResults).length > 0 && (
              <ul className="mt-3 space-y-1">
                {Object.entries(inviteResults).map(([email, status]) => (
                  <li key={email} className="flex items-center gap-2 font-mono text-[11px]">
                    <span className={status === 'sent' ? 'text-green' : 'text-red'}>
                      {status === 'sent' ? '✓' : '×'}
                    </span>
                    <span className="text-fg-secondary">{email}</span>
                  </li>
                ))}
              </ul>
            )}

            <div className="mt-4 flex items-center justify-between">
              <button
                onClick={() => {
                  void createDocumentAndClose()
                }}
                disabled={creatingDoc}
                className="font-mono text-[11px] text-fg-muted hover:text-fg"
              >
                Skip
              </button>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => {
                    void sendInvites()
                  }}
                  disabled={sendingInvites}
                  className="rounded border border-border bg-bg px-3 py-[7px] font-mono text-[12px] text-fg-secondary hover:text-fg disabled:opacity-50"
                >
                  {sendingInvites ? 'Sending...' : 'Send invites'}
                </button>
                <button
                  onClick={() => {
                    void createDocumentAndClose()
                  }}
                  disabled={creatingDoc}
                  className="rounded bg-fg px-4 py-[7px] font-mono text-[12.5px] font-medium text-bg disabled:opacity-50"
                >
                  {creatingDoc ? 'Creating...' : 'Finish'}
                </button>
              </div>
            </div>
          </div>
        )}

        {step === 3 && path === 'local' && (
          <div className="animate-[fade-in_150ms_ease-out]">
            <h2 className="font-mono text-[14px] font-semibold tracking-[-0.02em] text-fg">Sync local files</h2>
            <p className="mt-1 font-sans text-sm text-fg-secondary">
              Continue to connect your machine and link a folder for sync.
            </p>
            <div className="mt-4 rounded border border-border bg-bg-subtle p-3">
              <p className="font-mono text-[12px] text-fg">Open /connect</p>
              <p className="mt-1 font-sans text-xs text-fg-muted">
                Install the CLI, authenticate, and link your local folder.
              </p>
            </div>
            <div className="mt-4 flex items-center justify-between">
              <button
                onClick={finish}
                className="font-mono text-[11px] text-fg-muted hover:text-fg"
              >
                Skip
              </button>
              <button
                onClick={finishAndGoToConnect}
                className="rounded bg-fg px-4 py-[7px] font-mono text-[12.5px] font-medium text-bg"
              >
                Continue
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
