'use client'

import { useState, Suspense } from 'react'
import { useSearchParams } from 'next/navigation'
import { signIn } from '@/lib/auth-client'
import Link from 'next/link'

function sanitizeCallbackURL(raw: string | null): string {
  if (!raw) return '/'
  if (raw.startsWith('/')) return raw.startsWith('//') ? '/' : raw
  try {
    const parsed = new URL(raw)
    if (typeof window !== 'undefined' && parsed.origin === window.location.origin) {
      return `${parsed.pathname}${parsed.search}${parsed.hash}`
    }
  } catch {
    // fall through
  }
  return '/'
}

function SignupForm() {
  const searchParams = useSearchParams()
  const callbackURL = sanitizeCallbackURL(searchParams.get('callbackURL'))

  const [email, setEmail] = useState('')
  const [name, setName] = useState('')
  const [loading, setLoading] = useState(false)
  const [socialLoading, setSocialLoading] = useState<string | null>(null)
  const [sent, setSent] = useState(false)
  const [error, setError] = useState('')

  async function handleMagicLink(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError('')
    try {
      const payload: { email: string; callbackURL: string; name?: string } = { email, callbackURL }
      const trimmedName = name.trim()
      if (trimmedName) payload.name = trimmedName
      await signIn.magicLink(payload as never)
      setSent(true)
    } catch {
      setError('Failed to send magic link. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  async function handleSocial(provider: 'google' | 'github') {
    setSocialLoading(provider)
    setError('')
    try {
      await signIn.social({ provider, callbackURL })
    } catch {
      setError(`Failed to sign in with ${provider}. Please try again.`)
      setSocialLoading(null)
    }
  }

  if (sent) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-bg-subtle">
        <div className="w-full max-w-sm rounded-lg border border-border bg-bg p-8 text-center shadow">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-accent-subtle">
            <svg className="h-6 w-6 text-accent" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M21.75 6.75v10.5a2.25 2.25 0 01-2.25 2.25h-15a2.25 2.25 0 01-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25m19.5 0v.243a2.25 2.25 0 01-1.07 1.916l-7.5 4.615a2.25 2.25 0 01-2.36 0L3.32 8.91a2.25 2.25 0 01-1.07-1.916V6.75" />
            </svg>
          </div>
          <h2 className="mb-2 font-mono text-[18px] font-semibold tracking-[-0.02em] text-fg">Check your email</h2>
          <p className="mb-6 font-sans text-sm text-fg-secondary">
            We sent a sign-in link to <span className="font-medium text-fg">{email}</span>
          </p>
          <button
            onClick={() => setSent(false)}
            className="font-sans text-sm text-accent hover:text-accent-hover"
          >
            Use a different email
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-bg-subtle">
      <div className="w-full max-w-sm rounded-lg border border-border bg-bg p-8 shadow">
        <h1 className="mb-1 font-mono text-[18px] font-semibold tracking-[-0.02em] text-fg">Create your account</h1>
        <p className="mb-6 font-sans text-sm text-fg-secondary">Get started with CollabMD</p>

        {error && (
          <div className="mb-4 rounded bg-red-subtle px-3 py-2 text-sm text-red">
            {error}
          </div>
        )}

        <form onSubmit={handleMagicLink} className="space-y-3">
          <div>
            <label htmlFor="name" className="mb-1 block font-mono text-[11px] font-medium uppercase tracking-[0.02em] text-fg-secondary">
              Name
            </label>
            <input
              id="name"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Your name"
              className="w-full rounded border border-border bg-bg px-3 py-[7px] font-mono text-[13px] text-fg placeholder:text-fg-faint focus:border-fg focus:outline-none"
            />
          </div>
          <div>
            <label htmlFor="email" className="mb-1 block font-mono text-[11px] font-medium uppercase tracking-[0.02em] text-fg-secondary">
              Email
            </label>
            <input
              id="email"
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              className="w-full rounded border border-border bg-bg px-3 py-[7px] font-mono text-[13px] text-fg placeholder:text-fg-faint focus:border-fg focus:outline-none"
            />
          </div>
          <button
            type="submit"
            disabled={loading}
            className="w-full rounded bg-fg px-4 py-[7px] font-mono text-[12.5px] font-medium text-bg hover:bg-[#333] disabled:opacity-50"
          >
            {loading ? 'Sending...' : 'Send magic link'}
          </button>
        </form>

        <div className="my-6 flex items-center gap-3">
          <div className="h-px flex-1 bg-border" />
          <span className="font-mono text-[10px] uppercase tracking-[0.06em] text-fg-faint">or</span>
          <div className="h-px flex-1 bg-border" />
        </div>

        <div className="space-y-2">
          <button
            onClick={() => handleSocial('google')}
            disabled={socialLoading !== null}
            className="flex w-full items-center justify-center gap-2 rounded border border-border-strong bg-bg px-4 py-[7px] font-mono text-[12.5px] font-medium text-fg hover:bg-bg-hover disabled:opacity-50"
          >
            <svg className="h-4 w-4" viewBox="0 0 24 24">
              <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 01-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" />
              <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
              <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
              <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
            </svg>
            {socialLoading === 'google' ? 'Redirecting...' : 'Sign up with Google'}
          </button>
          <button
            onClick={() => handleSocial('github')}
            disabled={socialLoading !== null}
            className="flex w-full items-center justify-center gap-2 rounded border border-border-strong bg-bg px-4 py-[7px] font-mono text-[12.5px] font-medium text-fg hover:bg-bg-hover disabled:opacity-50"
          >
            <svg className="h-4 w-4" viewBox="0 0 24 24" fill="currentColor">
              <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0024 12c0-6.63-5.37-12-12-12z" />
            </svg>
            {socialLoading === 'github' ? 'Redirecting...' : 'Sign up with GitHub'}
          </button>
        </div>

        <p className="mt-6 text-center font-sans text-sm text-fg-muted">
          Already have an account?{' '}
          <Link href="/login" className="text-accent hover:text-accent-hover">
            Sign in
          </Link>
        </p>
      </div>
    </div>
  )
}

export default function SignupPage() {
  return (
    <Suspense>
      <SignupForm />
    </Suspense>
  )
}
