'use client'

import { useCallback, useEffect, useState } from 'react'

interface Collaborator {
  userId: string
  name: string
  email: string
  role: string
}

interface ShareLink {
  id: string
  token: string
  permission: string
  hasPassword: boolean
  expiresAt: string | null
  createdAt: string
}

interface ShareModalProps {
  docId: string
  open: boolean
  onClose: () => void
}

export default function ShareModal({ docId, open, onClose }: ShareModalProps) {
  const [email, setEmail] = useState('')
  const [role, setRole] = useState<'viewer' | 'commenter' | 'editor'>('viewer')
  const [shareMsg, setShareMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null)
  const [collaborators, setCollaborators] = useState<Collaborator[]>([])

  const [links, setLinks] = useState<ShareLink[]>([])
  const [linkPerm, setLinkPerm] = useState<'viewer' | 'commenter' | 'editor'>('viewer')
  const [linkPassword, setLinkPassword] = useState('')
  const [linkExpiry, setLinkExpiry] = useState('')
  const [copiedId, setCopiedId] = useState<string | null>(null)

  const fetchCollaborators = useCallback(async () => {
    const res = await fetch(`/api/documents/${docId}/share`)
    if (res.ok) setCollaborators(await res.json())
  }, [docId])

  const fetchLinks = useCallback(async () => {
    const res = await fetch(`/api/documents/${docId}/share-links`)
    if (res.ok) setLinks(await res.json())
  }, [docId])

  useEffect(() => {
    if (open) {
      fetchCollaborators()
      fetchLinks()
    }
  }, [open, fetchCollaborators, fetchLinks])

  if (!open) return null

  const handleShare = async () => {
    setShareMsg(null)
    const res = await fetch(`/api/documents/${docId}/share`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, role }),
    })
    if (res.ok) {
      setShareMsg({ type: 'ok', text: `Shared with ${email}` })
      setEmail('')
      fetchCollaborators()
    } else {
      const data = await res.json()
      const msg = data.error === 'user_not_found'
        ? 'User not found — they need an account first'
        : data.error ?? 'Failed to share'
      setShareMsg({ type: 'err', text: msg })
    }
  }

  const handleRemove = async (userId: string, userRole: string) => {
    await fetch(`/api/documents/${docId}/share`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId, role: userRole }),
    })
    fetchCollaborators()
  }

  const handleCreateLink = async () => {
    const body: Record<string, unknown> = { permission: linkPerm }
    if (linkPassword) body.password = linkPassword
    if (linkExpiry) body.expiresInDays = Number(linkExpiry)

    const res = await fetch(`/api/documents/${docId}/share-links`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    if (res.ok) {
      setLinkPassword('')
      setLinkExpiry('')
      fetchLinks()
    }
  }

  const handleRevokeLink = async (linkId: string) => {
    await fetch(`/api/documents/${docId}/share-links/${linkId}`, { method: 'DELETE' })
    fetchLinks()
  }

  const handleCopyLink = (token: string, id: string) => {
    navigator.clipboard.writeText(`${window.location.origin}/share/${token}`)
    setCopiedId(id)
    setTimeout(() => setCopiedId(null), 2000)
  }

  const roleBadge = (r: string) => {
    const colors: Record<string, string> = {
      owner: 'bg-purple-100 text-purple-700',
      editor: 'bg-blue-100 text-blue-700',
      commenter: 'bg-yellow-100 text-yellow-700',
      viewer: 'bg-gray-100 text-gray-600',
    }
    return (
      <span className={`rounded px-1.5 py-0.5 text-xs font-medium ${colors[r] ?? 'bg-gray-100 text-gray-600'}`}>
        {r}
      </span>
    )
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/50 backdrop-blur-sm" onClick={onClose}>
      <div className="mt-24 w-full max-w-lg rounded-lg bg-white p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-medium text-gray-900">Share document</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">&times;</button>
        </div>

        {/* Section 1: Share by email */}
        <div className="mb-4">
          <div className="flex gap-2">
            <input
              type="email"
              placeholder="Email address"
              className="flex-1 rounded border border-gray-300 px-3 py-1.5 text-sm"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') handleShare() }}
            />
            <select
              className="rounded border border-gray-300 px-2 py-1.5 text-sm"
              value={role}
              onChange={(e) => setRole(e.target.value as typeof role)}
            >
              <option value="viewer">Viewer</option>
              <option value="commenter">Commenter</option>
              <option value="editor">Editor</option>
            </select>
            <button
              onClick={handleShare}
              className="rounded bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700"
            >
              Share
            </button>
          </div>
          {shareMsg && (
            <p className={`mt-1.5 text-xs ${shareMsg.type === 'ok' ? 'text-green-600' : 'text-red-600'}`}>
              {shareMsg.text}
            </p>
          )}
        </div>

        <hr className="my-4 border-gray-200" />

        {/* Section 2: Current collaborators */}
        <div className="mb-4">
          <h3 className="mb-2 text-sm font-medium text-gray-700">Collaborators</h3>
          {collaborators.length === 0 ? (
            <p className="text-xs text-gray-400">No collaborators yet</p>
          ) : (
            <ul className="space-y-2">
              {collaborators.map((c) => (
                <li key={`${c.userId}-${c.role}`} className="flex items-center justify-between text-sm">
                  <div className="flex items-center gap-2">
                    <span className="text-gray-700">{c.name || c.email}</span>
                    {c.name && <span className="text-xs text-gray-400">{c.email}</span>}
                    {roleBadge(c.role)}
                  </div>
                  {c.role !== 'owner' && (
                    <button
                      onClick={() => handleRemove(c.userId, c.role)}
                      className="text-xs text-gray-400 hover:text-red-500"
                    >
                      Remove
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>

        <hr className="my-4 border-gray-200" />

        {/* Section 3: Share links */}
        <div>
          <h3 className="mb-2 text-sm font-medium text-gray-700">Share links</h3>
          {links.length > 0 && (
            <ul className="mb-3 space-y-2">
              {links.map((link) => (
                <li key={link.id} className="flex items-center justify-between rounded border border-gray-100 px-2 py-1.5 text-xs">
                  <div className="flex items-center gap-2">
                    {roleBadge(link.permission)}
                    {link.hasPassword && <span className="text-gray-400">password</span>}
                    {link.expiresAt && (
                      <span className="text-gray-400">
                        expires {new Date(link.expiresAt).toLocaleDateString()}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => handleCopyLink(link.token, link.id)}
                      className="text-blue-600 hover:text-blue-700"
                    >
                      {copiedId === link.id ? 'Copied!' : 'Copy'}
                    </button>
                    <button
                      onClick={() => handleRevokeLink(link.id)}
                      className="text-gray-400 hover:text-red-500"
                    >
                      Revoke
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
          <div className="flex gap-2">
            <select
              className="rounded border border-gray-300 px-2 py-1.5 text-sm"
              value={linkPerm}
              onChange={(e) => setLinkPerm(e.target.value as typeof linkPerm)}
            >
              <option value="viewer">Viewer</option>
              <option value="commenter">Commenter</option>
              <option value="editor">Editor</option>
            </select>
            <input
              type="text"
              placeholder="Password (optional)"
              className="w-28 rounded border border-gray-300 px-2 py-1.5 text-sm"
              value={linkPassword}
              onChange={(e) => setLinkPassword(e.target.value)}
            />
            <input
              type="number"
              placeholder="Days"
              className="w-16 rounded border border-gray-300 px-2 py-1.5 text-sm"
              value={linkExpiry}
              onChange={(e) => setLinkExpiry(e.target.value)}
            />
            <button
              onClick={handleCreateLink}
              className="rounded bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700"
            >
              Create link
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
