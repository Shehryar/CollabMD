'use client'

import { useEffect, useState } from 'react'
import { useSession } from '@/lib/auth-client'
import type { EmailNotificationPreference } from '@collabmd/shared'

const options: Array<{
  value: EmailNotificationPreference
  title: string
  description: string
}> = [
  {
    value: 'all',
    title: 'All emails',
    description: 'Send email for share invites and comment mentions.',
  },
  {
    value: 'mentions',
    title: 'Mentions only',
    description: 'Only send email when someone mentions you in a comment thread.',
  },
  {
    value: 'none',
    title: 'No email',
    description: 'Disable share invite and mention emails.',
  },
]

export default function NotificationSettingsPage() {
  const { data: session } = useSession()
  const [emailNotifications, setEmailNotifications] = useState<EmailNotificationPreference>('all')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    let cancelled = false

    async function load() {
      try {
        const res = await fetch('/api/settings/notifications', { cache: 'no-store' })
        if (!res.ok) {
          if (!cancelled) {
            setError('Failed to load notification settings.')
            setLoading(false)
          }
          return
        }

        const body = (await res.json()) as { emailNotifications?: EmailNotificationPreference }
        if (!cancelled) {
          setEmailNotifications(body.emailNotifications ?? 'all')
          setLoading(false)
        }
      } catch {
        if (!cancelled) {
          setError('Failed to load notification settings.')
          setLoading(false)
        }
      }
    }

    void load()
    return () => {
      cancelled = true
    }
  }, [])

  async function savePreference(nextValue: EmailNotificationPreference) {
    setEmailNotifications(nextValue)
    setSaving(true)
    setSaved(false)
    setError('')

    try {
      const res = await fetch('/api/settings/notifications', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ emailNotifications: nextValue }),
      })

      if (!res.ok) {
        setError('Failed to save notification settings.')
        return
      }

      const body = (await res.json()) as { emailNotifications?: EmailNotificationPreference }
      setEmailNotifications(body.emailNotifications ?? nextValue)
      setSaved(true)
      window.setTimeout(() => setSaved(false), 1600)
    } catch {
      setError('Failed to save notification settings.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-8 sm:px-6">
      <div className="rounded border border-border bg-bg p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="font-mono text-[10.5px] font-medium uppercase tracking-[0.08em] text-fg-muted">
              User settings
            </p>
            <h1 className="mt-1 font-mono text-[18px] font-semibold tracking-[-0.03em] text-fg">
              Email notifications
            </h1>
            <p className="mt-2 max-w-xl text-sm text-fg-secondary">
              Choose whether CollabMD emails you for share invites and comment mentions.
            </p>
          </div>
          <div className="min-w-[140px] text-right">
            {saving && <p className="font-mono text-[11px] text-fg-muted">Saving...</p>}
            {!saving && saved && <p className="font-mono text-[11px] text-green">Saved</p>}
            {!saving && session?.user?.email && (
              <p className="text-[12px] text-fg-muted">{session.user.email}</p>
            )}
          </div>
        </div>

        {error && (
          <div className="mt-4 rounded border border-red/30 bg-red-subtle px-3 py-2 text-sm text-red">
            {error}
          </div>
        )}

        <div className="mt-5 space-y-3">
          {options.map((option) => {
            const selected = emailNotifications === option.value
            return (
              <button
                key={option.value}
                type="button"
                onClick={() => void savePreference(option.value)}
                disabled={loading || saving}
                className={`flex w-full items-start gap-3 rounded border px-4 py-3 text-left transition-colors disabled:opacity-60 ${
                  selected
                    ? 'border-accent bg-accent-subtle'
                    : 'border-border bg-bg-subtle hover:border-border-strong hover:bg-bg'
                }`}
              >
                <span
                  className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border ${
                    selected ? 'border-accent bg-accent' : 'border-border bg-bg'
                  }`}
                >
                  {selected && <span className="h-1.5 w-1.5 rounded-full bg-accent-text" />}
                </span>
                <span className="min-w-0">
                  <span className="block font-mono text-[12px] font-medium text-fg">
                    {option.title}
                  </span>
                  <span className="mt-1 block text-sm text-fg-secondary">
                    {option.description}
                  </span>
                </span>
              </button>
            )
          })}
        </div>
      </div>
    </div>
  )
}
