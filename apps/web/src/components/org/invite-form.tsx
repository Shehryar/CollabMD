'use client'

import { useState } from 'react'
import { authClient } from '@/lib/auth-client'

const ROLES = ['member', 'admin', 'owner'] as const

interface InviteFormProps {
  onInvited: () => void
}

export default function InviteForm({ onInvited }: InviteFormProps) {
  const [email, setEmail] = useState('')
  const [role, setRole] = useState<'member' | 'admin' | 'owner'>('member')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!email.trim()) return

    setLoading(true)
    setError('')
    setSuccess('')

    const { error: err } = await authClient.organization.inviteMember({
      email: email.trim(),
      role,
    })

    if (err) {
      setError(err.message ?? 'Failed to send invite')
      setLoading(false)
      return
    }

    setSuccess(`Invited ${email}`)
    setEmail('')
    setRole('member')
    setLoading(false)
    onInvited()
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <div className="flex gap-2">
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="email@example.com"
          className="flex-1 rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-gray-900 focus:outline-none focus:ring-1 focus:ring-gray-900"
          required
        />
        <select
          value={role}
          onChange={(e) => setRole(e.target.value as typeof role)}
          className="rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-gray-900 focus:outline-none focus:ring-1 focus:ring-gray-900"
        >
          {ROLES.map((r) => (
            <option key={r} value={r}>{r}</option>
          ))}
        </select>
        <button
          type="submit"
          disabled={loading || !email.trim()}
          className="rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-50"
        >
          {loading ? 'Sending...' : 'Invite'}
        </button>
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}
      {success && <p className="text-sm text-green-600">{success}</p>}
    </form>
  )
}
