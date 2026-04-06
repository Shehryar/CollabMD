'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

interface Collaborator {
  userId: string | null
  invitationId: string | null
  pending: boolean
  name: string
  email: string
  role: string
}

interface FolderShareModalProps {
  folderId: string
  folderName: string
  open: boolean
  onClose: () => void
}

async function copyText(value: string): Promise<void> {
  await navigator.clipboard.writeText(value)
}

function getPendingInviteUrl(folderId: string): string {
  const callbackURL = encodeURIComponent(`/?folder=${folderId}`)
  if (typeof window !== 'undefined') {
    return `${window.location.origin}/signup?callbackURL=${callbackURL}`
  }
  return `/signup?callbackURL=${callbackURL}`
}

export default function FolderShareModal({
  folderId,
  folderName,
  open,
  onClose,
}: FolderShareModalProps) {
  const modalRef = useRef<HTMLDivElement>(null)
  const [email, setEmail] = useState('')
  const [role, setRole] = useState<'viewer' | 'editor'>('viewer')
  const [shareMsg, setShareMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null)
  const [collaborators, setCollaborators] = useState<Collaborator[]>([])
  const [loadingCollaborators, setLoadingCollaborators] = useState(false)
  const [sharing, setSharing] = useState(false)
  const [creatingInviteLink, setCreatingInviteLink] = useState(false)
  const [removingTargetId, setRemovingTargetId] = useState<string | null>(null)

  const fetchCollaborators = useCallback(async () => {
    setLoadingCollaborators(true)
    try {
      const res = await fetch(`/api/folders/${folderId}/permissions`)
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
  }, [folderId])

  useEffect(() => {
    if (!open) return
    void fetchCollaborators()
  }, [open, fetchCollaborators])

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

  const createInvite = useCallback(
    async (sendEmail: boolean) => {
      if (!email.trim()) return { ok: false as const }

      const res = await fetch(`/api/folders/${folderId}/permissions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, role, sendEmail }),
      })

      const data = (await res.json().catch(() => ({}))) as {
        error?: string
        pending?: boolean
        inviteUrl?: string
      }

      if (!res.ok) {
        setShareMsg({ type: 'err', text: data.error ?? 'Failed to share folder' })
        return { ok: false as const }
      }

      return { ok: true as const, data }
    },
    [email, folderId, role],
  )

  const handleShare = async () => {
    if (!email.trim() || sharing) return
    setSharing(true)
    setShareMsg(null)
    try {
      const result = await createInvite(true)
      if (!result.ok) return
      setShareMsg({
        type: 'ok',
        text: result.data.pending
          ? `Invite sent to ${email}. They'll get access after creating an account.`
          : `Shared folder with ${email}`,
      })
      setEmail('')
      await fetchCollaborators()
    } catch {
      setShareMsg({ type: 'err', text: 'Failed to share folder' })
    } finally {
      setSharing(false)
    }
  }

  const handleCopyInviteLink = async () => {
    if (!email.trim() || creatingInviteLink) return
    setCreatingInviteLink(true)
    setShareMsg(null)
    try {
      const result = await createInvite(false)
      if (!result.ok || !result.data.inviteUrl) return
      await copyText(result.data.inviteUrl)
      setShareMsg({ type: 'ok', text: `Invite link copied for ${email}` })
      await fetchCollaborators()
    } catch {
      setShareMsg({ type: 'err', text: 'Failed to copy invite link' })
    } finally {
      setCreatingInviteLink(false)
    }
  }

  const handleCopyPendingInviteLink = async (collaborator: Collaborator) => {
    if (!collaborator.pending) return
    try {
      await copyText(getPendingInviteUrl(folderId))
      setShareMsg({ type: 'ok', text: `Invite link copied for ${collaborator.email}` })
    } catch {
      setShareMsg({ type: 'err', text: 'Failed to copy invite link' })
    }
  }

  const handleResendPendingInvite = async (collaborator: Collaborator) => {
    if (!collaborator.pending || !collaborator.email || sharing) return
    setSharing(true)
    setShareMsg(null)
    try {
      const res = await fetch(`/api/folders/${folderId}/permissions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: collaborator.email, role: collaborator.role, sendEmail: true }),
      })
      const data = await res.json().catch(() => ({}))

      if (!res.ok) {
        setShareMsg({ type: 'err', text: data.error ?? 'Failed to resend invite' })
        return
      }

      setShareMsg({ type: 'ok', text: `Invite email resent to ${collaborator.email}` })
      await fetchCollaborators()
    } catch {
      setShareMsg({ type: 'err', text: 'Failed to resend invite' })
    } finally {
      setSharing(false)
    }
  }

  const handleRemove = async (collaborator: Collaborator) => {
    const targetId = collaborator.userId ?? collaborator.invitationId
    if (!targetId || removingTargetId) return
    setRemovingTargetId(targetId)
    setShareMsg(null)
    try {
      const res = await fetch(`/api/folders/${folderId}/permissions`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: collaborator.userId,
          invitationId: collaborator.invitationId,
          role: collaborator.role,
        }),
      })
      if (!res.ok) {
        setShareMsg({ type: 'err', text: 'Failed to remove collaborator' })
        return
      }
      await fetchCollaborators()
    } catch {
      setShareMsg({ type: 'err', text: 'Failed to remove collaborator' })
    } finally {
      setRemovingTargetId(null)
    }
  }

  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/15 backdrop-blur-[2px]"
      onClick={onClose}
    >
      <div
        ref={modalRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="folder-share-dialog-title"
        tabIndex={-1}
        className="mt-24 w-[min(560px,calc(100vw-2rem))] max-h-[80vh] overflow-y-auto rounded-lg border border-border bg-bg shadow-lg"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <div>
            <h2 id="folder-share-dialog-title" className="font-mono text-sm font-semibold text-fg">
              Share folder
            </h2>
            <p className="mt-1 text-xs text-fg-muted">{folderName}</p>
          </div>
          <button
            onClick={onClose}
            className="flex h-6 w-6 items-center justify-center rounded-sm text-lg text-fg-muted hover:bg-bg-subtle hover:text-fg"
            aria-label="Close dialog"
          >
            &times;
          </button>
        </div>

        <div className="px-5 py-4">
          <div className="flex flex-wrap gap-2">
            <input
              type="email"
              placeholder="Email address"
              className="min-w-[220px] flex-1 rounded border border-border bg-bg px-[10px] py-[7px] font-mono text-[13px] text-fg focus:border-fg focus:outline-none"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') void handleShare()
              }}
              disabled={sharing || creatingInviteLink}
            />
            <select
              className="rounded border border-border bg-bg px-2 py-[7px] font-mono text-[12px] text-fg-secondary"
              value={role}
              onChange={(event) => setRole(event.target.value as typeof role)}
              disabled={sharing || creatingInviteLink}
            >
              <option value="viewer">Viewer</option>
              <option value="editor">Editor</option>
            </select>
            <button
              onClick={() => void handleCopyInviteLink()}
              disabled={sharing || creatingInviteLink}
              className="rounded border border-border px-4 py-[7px] font-mono text-[12.5px] font-medium hover:bg-bg-subtle disabled:opacity-50"
            >
              {creatingInviteLink ? 'Copying...' : 'Copy invite link'}
            </button>
            <button
              onClick={() => void handleShare()}
              disabled={sharing || creatingInviteLink}
              className="rounded bg-fg px-4 py-[7px] font-mono text-[12.5px] font-medium text-bg hover:bg-[#333] disabled:opacity-50"
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

        <div className="px-5 py-4">
          <h3 className="mb-2 font-mono text-[11px] font-medium uppercase tracking-[0.02em] text-fg-secondary">
            Collaborators
          </h3>
          {loadingCollaborators ? (
            <p className="text-xs text-fg-muted">Loading collaborators...</p>
          ) : collaborators.length === 0 ? (
            <p className="text-xs text-fg-muted">No collaborators yet</p>
          ) : (
            <ul>
              {collaborators.map((collaborator) => {
                const targetId =
                  collaborator.userId ?? collaborator.invitationId ?? collaborator.email
                return (
                  <li
                    key={targetId}
                    className="flex items-center gap-[10px] border-b border-border py-2"
                  >
                    <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-border bg-accent-subtle font-mono text-[9px] font-semibold text-accent">
                      {(collaborator.name || collaborator.email).charAt(0).toUpperCase()}
                    </span>
                    <div className="flex min-w-0 flex-1 flex-col">
                      <span className="font-sans text-[12.5px] font-medium text-fg">
                        {collaborator.name || collaborator.email}
                      </span>
                      {collaborator.name ? (
                        <span className="font-mono text-[11px] text-fg-muted">
                          {collaborator.email}
                        </span>
                      ) : collaborator.pending ? (
                        <span className="font-mono text-[11px] text-fg-muted">Pending invite</span>
                      ) : null}
                    </div>
                    <span className="font-mono text-[11px] text-fg-secondary">
                      {collaborator.role}
                    </span>
                    {collaborator.pending && (
                      <div className="ml-auto flex items-center gap-2 shrink-0">
                        <button
                          onClick={() => void handleCopyPendingInviteLink(collaborator)}
                          className="font-mono text-[11px] text-accent hover:text-accent-hover"
                        >
                          Copy link
                        </button>
                        <button
                          onClick={() => void handleResendPendingInvite(collaborator)}
                          disabled={sharing}
                          className="font-mono text-[11px] text-fg-muted hover:text-fg disabled:opacity-50"
                        >
                          {sharing ? 'Sending...' : 'Resend'}
                        </button>
                        <button
                          onClick={() => void handleRemove(collaborator)}
                          disabled={removingTargetId === targetId}
                          className="font-mono text-[11px] text-fg-muted hover:text-red disabled:opacity-50"
                        >
                          {removingTargetId === targetId ? 'Removing...' : 'Remove'}
                        </button>
                      </div>
                    )}
                    {!collaborator.pending && collaborator.role !== 'owner' && (
                      <button
                        onClick={() => void handleRemove(collaborator)}
                        disabled={removingTargetId === targetId}
                        className="ml-auto shrink-0 font-mono text-[11px] text-fg-muted hover:text-red disabled:opacity-50"
                      >
                        {removingTargetId === targetId ? 'Removing...' : 'Remove'}
                      </button>
                    )}
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      </div>
    </div>
  )
}
