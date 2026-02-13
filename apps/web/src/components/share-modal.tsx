'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

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
  const modalRef = useRef<HTMLDivElement>(null)
  const [email, setEmail] = useState('')
  const [role, setRole] = useState<'viewer' | 'commenter' | 'editor'>('viewer')
  const [shareMsg, setShareMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null)
  const [collaborators, setCollaborators] = useState<Collaborator[]>([])

  const [links, setLinks] = useState<ShareLink[]>([])
  const [linkPerm, setLinkPerm] = useState<'viewer' | 'commenter' | 'editor'>('viewer')
  const [linkPassword, setLinkPassword] = useState('')
  const [linkExpiry, setLinkExpiry] = useState('')
  const [copiedId, setCopiedId] = useState<string | null>(null)

  const [loadingCollaborators, setLoadingCollaborators] = useState(false)
  const [loadingLinks, setLoadingLinks] = useState(false)
  const [sharing, setSharing] = useState(false)
  const [removingUserId, setRemovingUserId] = useState<string | null>(null)
  const [updatingRoleUserId, setUpdatingRoleUserId] = useState<string | null>(null)
  const [creatingLink, setCreatingLink] = useState(false)
  const [revokingLinkId, setRevokingLinkId] = useState<string | null>(null)

  const fetchCollaborators = useCallback(async () => {
    setLoadingCollaborators(true)
    try {
      const res = await fetch(`/api/documents/${docId}/share`)
      if (!res.ok) {
        setShareMsg({ type: 'err', text: 'Failed to load collaborators' })
        return
      }
      setCollaborators(await res.json())
    } catch {
      setShareMsg({ type: 'err', text: 'Failed to load collaborators' })
    } finally {
      setLoadingCollaborators(false)
    }
  }, [docId])

  const fetchLinks = useCallback(async () => {
    setLoadingLinks(true)
    try {
      const res = await fetch(`/api/documents/${docId}/share-links`)
      if (!res.ok) {
        setShareMsg({ type: 'err', text: 'Failed to load share links' })
        return
      }
      setLinks(await res.json())
    } catch {
      setShareMsg({ type: 'err', text: 'Failed to load share links' })
    } finally {
      setLoadingLinks(false)
    }
  }, [docId])

  useEffect(() => {
    if (!open) return
    fetchCollaborators()
    fetchLinks()
  }, [open, fetchCollaborators, fetchLinks])

  useEffect(() => {
    if (!open) return

    const previousActive = document.activeElement as HTMLElement | null
    const node = modalRef.current
    node?.focus()

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        onClose()
        return
      }
      if (event.key !== 'Tab' || !node) return

      const focusables = Array.from(
        node.querySelectorAll<HTMLElement>(
          'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
        ),
      ).filter((el) => !el.hasAttribute('disabled') && el.getAttribute('aria-hidden') !== 'true')

      if (focusables.length === 0) {
        event.preventDefault()
        return
      }

      const first = focusables[0]
      const last = focusables[focusables.length - 1]
      const active = document.activeElement as HTMLElement | null

      if (event.shiftKey && active === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && active === last) {
        event.preventDefault()
        first.focus()
      }
    }

    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      previousActive?.focus()
    }
  }, [open, onClose])

  if (!open) return null

  const handleShare = async () => {
    if (!email.trim() || sharing) return
    setSharing(true)
    setShareMsg(null)
    try {
      const res = await fetch(`/api/documents/${docId}/share`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, role }),
      })
      if (res.ok) {
        setShareMsg({ type: 'ok', text: `Shared with ${email}` })
        setEmail('')
        await fetchCollaborators()
      } else {
        const data = await res.json().catch(() => ({}))
        const msg = data.error === 'user not found'
          ? 'User not found - they need an account first'
          : data.error ?? 'Failed to share'
        setShareMsg({ type: 'err', text: msg })
      }
    } catch {
      setShareMsg({ type: 'err', text: 'Failed to share' })
    } finally {
      setSharing(false)
    }
  }

  const handleRemove = async (userId: string, userRole: string) => {
    if (removingUserId) return
    setRemovingUserId(userId)
    setShareMsg(null)
    try {
      const res = await fetch(`/api/documents/${docId}/share`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, role: userRole }),
      })
      if (!res.ok) {
        setShareMsg({ type: 'err', text: 'Failed to remove collaborator' })
        return
      }
      await fetchCollaborators()
    } catch {
      setShareMsg({ type: 'err', text: 'Failed to remove collaborator' })
    } finally {
      setRemovingUserId(null)
    }
  }

  const handleRoleChange = async (
    userId: string,
    oldRole: string,
    newRole: 'viewer' | 'commenter' | 'editor',
  ) => {
    if (oldRole === newRole || updatingRoleUserId) return
    setUpdatingRoleUserId(userId)
    setShareMsg(null)
    setCollaborators((prev) =>
      prev.map((c) => (c.userId === userId ? { ...c, role: newRole } : c)),
    )

    try {
      const res = await fetch(`/api/documents/${docId}/share`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, oldRole, newRole }),
      })

      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        setCollaborators((prev) =>
          prev.map((c) => (c.userId === userId ? { ...c, role: oldRole } : c)),
        )
        setShareMsg({ type: 'err', text: data.error ?? 'Failed to update collaborator role' })
      }
    } catch {
      setCollaborators((prev) =>
        prev.map((c) => (c.userId === userId ? { ...c, role: oldRole } : c)),
      )
      setShareMsg({ type: 'err', text: 'Failed to update collaborator role' })
    } finally {
      setUpdatingRoleUserId(null)
    }
  }

  const handleCreateLink = async () => {
    if (creatingLink) return
    setCreatingLink(true)
    setShareMsg(null)

    const body: Record<string, unknown> = { permission: linkPerm }
    if (linkPassword) body.password = linkPassword
    if (linkExpiry) body.expiresInDays = Number(linkExpiry)

    try {
      const res = await fetch(`/api/documents/${docId}/share-links`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!res.ok) {
        setShareMsg({ type: 'err', text: 'Failed to create share link' })
        return
      }
      setLinkPassword('')
      setLinkExpiry('')
      await fetchLinks()
    } catch {
      setShareMsg({ type: 'err', text: 'Failed to create share link' })
    } finally {
      setCreatingLink(false)
    }
  }

  const handleRevokeLink = async (linkId: string) => {
    if (revokingLinkId) return
    setRevokingLinkId(linkId)
    setShareMsg(null)
    try {
      const res = await fetch(`/api/documents/${docId}/share-links/${linkId}`, { method: 'DELETE' })
      if (!res.ok) {
        setShareMsg({ type: 'err', text: 'Failed to revoke share link' })
        return
      }
      await fetchLinks()
    } catch {
      setShareMsg({ type: 'err', text: 'Failed to revoke share link' })
    } finally {
      setRevokingLinkId(null)
    }
  }

  const handleCopyLink = async (token: string, id: string) => {
    try {
      await navigator.clipboard.writeText(`${window.location.origin}/share/${token}`)
      setCopiedId(id)
      setTimeout(() => setCopiedId(null), 2000)
    } catch {
      setShareMsg({ type: 'err', text: 'Failed to copy link' })
    }
  }

  const roleBadge = (r: string) => {
    return (
      <span className="font-mono text-[11px] py-[3px] px-2 border border-border rounded-sm bg-bg text-fg-secondary">
        {r}
      </span>
    )
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/15 backdrop-blur-[2px]" onClick={onClose}>
      <div
        ref={modalRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="share-dialog-title"
        tabIndex={-1}
        className="mt-24 bg-bg border border-border rounded-lg shadow-lg w-[420px] max-h-[80vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="py-4 px-5 border-b border-border flex items-center justify-between">
          <h2 id="share-dialog-title" className="font-mono text-sm font-semibold tracking-[-0.02em] text-fg">Share document</h2>
          <button onClick={onClose} className="w-6 h-6 rounded-sm text-fg-muted hover:bg-bg-subtle hover:text-fg text-lg flex items-center justify-center" aria-label="Close dialog">&times;</button>
        </div>

        <div className="p-4 px-5">
          <div className="flex gap-2">
            <input
              type="email"
              placeholder="Email address"
              className="flex-1 font-mono text-[13px] py-[7px] px-[10px] border border-border rounded bg-bg text-fg focus:border-fg focus:outline-none"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') void handleShare() }}
              disabled={sharing}
            />
            <select
              className="font-mono text-[12px] border border-border rounded bg-bg text-fg-secondary px-2 py-[7px]"
              value={role}
              onChange={(e) => setRole(e.target.value as typeof role)}
              disabled={sharing}
            >
              <option value="viewer">Viewer</option>
              <option value="commenter">Commenter</option>
              <option value="editor">Editor</option>
            </select>
            <button
              onClick={() => void handleShare()}
              disabled={sharing}
              className="font-mono text-[12.5px] font-medium py-[7px] px-4 bg-fg text-bg rounded hover:bg-[#333] disabled:opacity-50"
            >
              {sharing ? 'Sharing...' : 'Share'}
            </button>
          </div>
          {shareMsg && (
            <p className={`mt-1.5 text-xs ${shareMsg.type === 'ok' ? 'text-green' : 'text-red'}`}>
              {shareMsg.text}
            </p>
          )}
        </div>

        <hr className="border-border" />

        <div className="p-4 px-5">
          <h3 className="mb-2 font-mono text-[11px] font-medium uppercase tracking-[0.02em] text-fg-secondary">Collaborators</h3>
          {loadingCollaborators ? (
            <p className="text-xs text-fg-muted">Loading collaborators...</p>
          ) : collaborators.length === 0 ? (
            <p className="text-xs text-fg-muted">No collaborators yet</p>
          ) : (
            <ul>
              {collaborators.map((c) => (
                <li key={c.userId} className="border-b border-border py-2 flex items-center gap-[10px]">
                  <span className="w-6 h-6 rounded-full bg-accent-subtle border border-border font-mono text-[9px] font-semibold text-accent flex items-center justify-center shrink-0">
                    {(c.name || c.email).charAt(0).toUpperCase()}
                  </span>
                  <div className="flex flex-col flex-1 min-w-0">
                    <span className="font-sans text-[12.5px] font-medium text-fg">{c.name || c.email}</span>
                    {c.name && <span className="font-mono text-[11px] text-fg-muted">{c.email}</span>}
                  </div>
                  {c.role === 'owner' ? (
                    <span className="font-mono text-[11px] text-fg-secondary">owner</span>
                  ) : (
                    <select
                      value={c.role}
                      onChange={(e) => {
                        void handleRoleChange(
                          c.userId,
                          c.role,
                          e.target.value as 'viewer' | 'commenter' | 'editor',
                        )
                      }}
                      disabled={updatingRoleUserId === c.userId}
                      className={`font-mono text-[11px] text-fg-secondary border border-border rounded-sm bg-bg px-2 py-0.5 cursor-pointer ${
                        updatingRoleUserId === c.userId ? 'opacity-60' : ''
                      }`}
                    >
                      <option value="viewer">viewer</option>
                      <option value="commenter">commenter</option>
                      <option value="editor">editor</option>
                    </select>
                  )}
                  {c.role !== 'owner' && (
                    <button
                      onClick={() => void handleRemove(c.userId, c.role)}
                      disabled={removingUserId === c.userId || updatingRoleUserId === c.userId}
                      className="font-mono text-[11px] text-fg-muted hover:text-red disabled:opacity-50 ml-auto shrink-0"
                    >
                      {removingUserId === c.userId ? 'Removing...' : 'Remove'}
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>

        <hr className="border-border" />

        <div className="p-4 px-5">
          <h3 className="mb-2 font-mono text-[11px] font-medium uppercase tracking-[0.02em] text-fg-secondary">Share links</h3>
          {loadingLinks ? (
            <p className="mb-3 text-xs text-fg-muted">Loading share links...</p>
          ) : links.length > 0 ? (
            <ul className="mb-3">
              {links.map((link) => (
                <li key={link.id} className="border-b border-border py-2 flex items-center justify-between text-xs">
                  <div className="flex items-center gap-2">
                    {roleBadge(link.permission)}
                    {link.hasPassword && <span className="font-mono text-[11px] text-fg-muted">password</span>}
                    {link.expiresAt && (
                      <span className="font-mono text-[11px] text-fg-muted">
                        expires {new Date(link.expiresAt).toLocaleDateString()}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => void handleCopyLink(link.token, link.id)}
                      className="font-mono text-[11px] text-accent hover:text-accent-hover"
                    >
                      {copiedId === link.id ? 'Copied!' : 'Copy'}
                    </button>
                    <button
                      onClick={() => void handleRevokeLink(link.id)}
                      disabled={revokingLinkId === link.id}
                      className="font-mono text-[11px] text-fg-muted hover:text-red disabled:opacity-50"
                    >
                      {revokingLinkId === link.id ? 'Revoking...' : 'Revoke'}
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mb-3 text-xs text-fg-muted">No share links yet</p>
          )}
          <div className="flex gap-2">
            <select
              className="font-mono text-[12px] border border-border rounded bg-bg text-fg-secondary px-2 py-[7px]"
              value={linkPerm}
              onChange={(e) => setLinkPerm(e.target.value as typeof linkPerm)}
              disabled={creatingLink}
            >
              <option value="viewer">Viewer</option>
              <option value="commenter">Commenter</option>
              <option value="editor">Editor</option>
            </select>
            <input
              type="text"
              placeholder="Password (optional)"
              className="w-28 font-mono text-[13px] py-[7px] px-[10px] border border-border rounded bg-bg text-fg focus:border-fg focus:outline-none"
              value={linkPassword}
              onChange={(e) => setLinkPassword(e.target.value)}
              disabled={creatingLink}
            />
            <input
              type="number"
              placeholder="Days"
              className="w-16 font-mono text-[13px] py-[7px] px-[10px] border border-border rounded bg-bg text-fg focus:border-fg focus:outline-none"
              value={linkExpiry}
              onChange={(e) => setLinkExpiry(e.target.value)}
              disabled={creatingLink}
            />
            <button
              onClick={() => void handleCreateLink()}
              disabled={creatingLink}
              className="font-mono text-[12.5px] font-medium py-[7px] px-4 bg-fg text-bg rounded hover:bg-[#333] disabled:opacity-50"
            >
              {creatingLink ? 'Creating...' : 'Create link'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
