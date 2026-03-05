'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { authClient } from '@/lib/auth-client'

export default function NewOrgPage() {
  const router = useRouter()
  const [name, setName] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!name.trim()) return

    setLoading(true)
    setError('')

    const { error: err } = await authClient.organization.create({
      name: name.trim(),
      slug,
    })

    if (err) {
      setError(err.message ?? 'Failed to create organization')
      setLoading(false)
      return
    }

    router.push(`/org/${slug}/settings`)
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-bg-subtle">
      <div className="w-full max-w-sm rounded-lg border border-border bg-bg p-8 shadow">
        <h1 className="font-mono text-[18px] font-semibold tracking-[-0.02em] text-fg">
          Create organization
        </h1>
        <p className="mt-1 font-sans text-sm text-fg-secondary">
          Set up a new workspace for your team.
        </p>

        <form onSubmit={handleSubmit} className="mt-6 space-y-4">
          <div>
            <label
              htmlFor="name"
              className="block font-mono text-[11px] font-medium uppercase tracking-[0.02em] text-fg-secondary"
            >
              Organization name
            </label>
            <input
              id="name"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Acme Inc"
              className="mt-1 block w-full rounded border border-border bg-bg px-3 py-[7px] font-mono text-[13px] text-fg placeholder:text-fg-faint focus:border-fg focus:outline-none"
              required
            />
            {slug && <p className="mt-1 font-mono text-[11px] text-fg-muted">Slug: {slug}</p>}
          </div>

          {error && <p className="text-sm text-red">{error}</p>}

          <button
            type="submit"
            disabled={loading || !name.trim()}
            className="w-full rounded bg-fg px-4 py-[7px] font-mono text-[12.5px] font-medium text-bg hover:bg-[#333] disabled:opacity-50"
          >
            {loading ? 'Creating...' : 'Create organization'}
          </button>
        </form>

        <button
          onClick={() => router.back()}
          className="mt-4 w-full text-center font-mono text-sm text-fg-muted hover:text-fg"
        >
          Cancel
        </button>
      </div>
    </div>
  )
}
