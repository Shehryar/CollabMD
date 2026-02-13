'use client'

import { useParams, useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'

export default function SharePage() {
  const { token } = useParams<{ token: string }>()
  const router = useRouter()
  const [state, setState] = useState<'loading' | 'password' | 'error'>('loading')
  const [error, setError] = useState('')
  const [password, setPassword] = useState('')
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    validate()
  }, [token])

  async function validate(pw?: string) {
    try {
      const res = await fetch(`/api/share/${token}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(pw ? { password: pw } : {}),
      })

      if (res.ok) {
        const { documentId, permission } = await res.json()
        router.replace(`/doc/${documentId}?permission=${permission}`)
        return
      }

      const data = await res.json()

      if (data.error === 'password required') {
        setState('password')
        return
      }

      if (data.error === 'wrong password') {
        setError('Incorrect password')
        return
      }

      if (data.error === 'expired') {
        setState('error')
        setError('This share link has expired')
        return
      }

      setState('error')
      setError('Share link not found')
    } catch {
      setState('error')
      setError('Network error while validating share link')
    } finally {
      setSubmitting(false)
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setSubmitting(true)
    setError('')
    void validate(password)
  }

  if (state === 'loading') {
    return (
      <div className="flex min-h-screen items-center justify-center bg-bg-subtle">
        <p className="font-sans text-sm text-fg-muted">Loading...</p>
      </div>
    )
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-bg-subtle">
      <div className="w-full max-w-sm rounded-lg border border-border bg-bg p-6 shadow">
        {state === 'error' ? (
          <div className="text-center">
            <h2 className="font-mono text-[18px] font-semibold tracking-[-0.02em] text-fg">Unable to access document</h2>
            <p className="mt-2 font-sans text-sm text-fg-secondary">{error}</p>
          </div>
        ) : (
          <form onSubmit={handleSubmit}>
            <h2 className="font-mono text-[18px] font-semibold tracking-[-0.02em] text-fg">Password required</h2>
            <p className="mt-1 font-sans text-sm text-fg-secondary">
              This document is password-protected.
            </p>
            <input
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              placeholder="Enter password"
              className="mt-4 w-full rounded border border-border bg-bg px-3 py-[7px] font-mono text-[13px] text-fg placeholder:text-fg-faint focus:border-fg focus:outline-none"
              autoFocus
            />
            {error && <p className="mt-2 text-sm text-red">{error}</p>}
            <button
              type="submit"
              disabled={submitting || !password}
              className="mt-4 w-full rounded bg-fg px-4 py-[7px] font-mono text-[12.5px] font-medium text-bg hover:bg-[#333] disabled:opacity-50"
            >
              {submitting ? 'Verifying...' : 'Continue'}
            </button>
          </form>
        )}
      </div>
    </div>
  )
}
