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
    const res = await fetch(`/api/share/${token}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(pw ? { password: pw } : {}),
    })

    if (res.ok) {
      const { documentId, permission } = await res.json()
      router.replace(`/doc/${documentId}?share_token=${token}&permission=${permission}`)
      return
    }

    const data = await res.json()

    if (data.error === 'password_required') {
      setState('password')
      return
    }

    if (data.error === 'wrong_password') {
      setError('Incorrect password')
      setSubmitting(false)
      return
    }

    if (data.error === 'expired') {
      setState('error')
      setError('This share link has expired')
      return
    }

    setState('error')
    setError('Share link not found')
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setSubmitting(true)
    setError('')
    await validate(password)
  }

  if (state === 'loading') {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <p className="text-muted-foreground">Loading...</p>
      </div>
    )
  }

  return (
    <div className="flex min-h-screen items-center justify-center">
      <div className="w-full max-w-sm rounded-lg border p-6">
        {state === 'error' ? (
          <div className="text-center">
            <h2 className="text-lg font-medium">Unable to access document</h2>
            <p className="mt-2 text-sm text-muted-foreground">{error}</p>
          </div>
        ) : (
          <form onSubmit={handleSubmit}>
            <h2 className="text-lg font-medium">Password required</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              This document is password-protected.
            </p>
            <input
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              placeholder="Enter password"
              className="mt-4 w-full rounded border px-3 py-2 text-sm"
              autoFocus
            />
            {error && <p className="mt-2 text-sm text-red-500">{error}</p>}
            <button
              type="submit"
              disabled={submitting || !password}
              className="mt-4 w-full rounded bg-primary px-3 py-2 text-sm text-primary-foreground disabled:opacity-50"
            >
              {submitting ? 'Verifying...' : 'Continue'}
            </button>
          </form>
        )}
      </div>
    </div>
  )
}
