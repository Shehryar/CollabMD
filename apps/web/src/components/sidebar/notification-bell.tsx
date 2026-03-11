'use client'

import type { NotificationRealtimeEvent, NotificationRecord } from '@collabmd/shared'
import * as decoding from 'lib0/decoding'
import { usePathname, useRouter } from 'next/navigation'
import { useEffect, useRef, useState } from 'react'
import { getNotificationHref } from '@/lib/notification-utils'

const DEFAULT_SYNC_PORT = '4444'
const DEFAULT_LIMIT = 20
const messageNotification = 4

function isLoopbackHost(hostname: string): boolean {
  return hostname === 'localhost' || hostname === '127.0.0.1'
}

function resolveSyncUrl(): string {
  const configured = process.env.NEXT_PUBLIC_SYNC_URL?.trim()

  if (typeof window === 'undefined') {
    return configured || `ws://localhost:${DEFAULT_SYNC_PORT}`
  }

  const browserProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
  const browserHost = window.location.hostname
  const fallback = `${browserProtocol}//${browserHost}:${DEFAULT_SYNC_PORT}`

  if (!configured) return fallback

  try {
    const url = new URL(configured)
    if (isLoopbackHost(url.hostname) && !isLoopbackHost(browserHost)) {
      url.hostname = browserHost
    }
    if (browserProtocol === 'wss:' && url.protocol === 'ws:') {
      url.protocol = 'wss:'
    }
    return url.toString().replace(/\/$/, '')
  } catch {
    return fallback
  }
}

function relativeTime(value: string): string {
  const then = Date.parse(value)
  if (!Number.isFinite(then)) return 'now'

  const diffSeconds = Math.max(1, Math.floor((Date.now() - then) / 1000))
  if (diffSeconds < 60) return `${diffSeconds}s`
  const diffMinutes = Math.floor(diffSeconds / 60)
  if (diffMinutes < 60) return `${diffMinutes}m`
  const diffHours = Math.floor(diffMinutes / 60)
  if (diffHours < 24) return `${diffHours}h`
  const diffDays = Math.floor(diffHours / 24)
  return `${diffDays}d`
}

function setNotificationReadState(
  notifications: NotificationRecord[],
  ids: string[],
): { notifications: NotificationRecord[]; markedUnreadCount: number } {
  let markedUnreadCount = 0
  const unreadIds = new Set(ids)
  const next = notifications.map((notification) => {
    if (!unreadIds.has(notification.id) || notification.read) return notification
    markedUnreadCount += 1
    return { ...notification, read: true }
  })
  return { notifications: next, markedUnreadCount }
}

interface NotificationBellProps {
  userId?: string
  orgId?: string | null
  onNavigate?: () => void
}

export function NotificationBell({ userId, orgId, onNavigate }: NotificationBellProps) {
  const router = useRouter()
  const pathname = usePathname()
  const rootRef = useRef<HTMLDivElement>(null)
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(true)
  const [markingAll, setMarkingAll] = useState(false)
  const [notifications, setNotifications] = useState<NotificationRecord[]>([])
  const [unreadCount, setUnreadCount] = useState(0)

  useEffect(() => {
    const onPointerDown = (event: MouseEvent) => {
      const target = event.target as Node | null
      if (target && rootRef.current?.contains(target)) return
      setOpen(false)
    }

    const onEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false)
      }
    }

    window.addEventListener('mousedown', onPointerDown)
    window.addEventListener('keydown', onEscape)
    return () => {
      window.removeEventListener('mousedown', onPointerDown)
      window.removeEventListener('keydown', onEscape)
    }
  }, [])

  useEffect(() => {
    let cancelled = false

    const loadNotifications = async () => {
      if (!userId || !orgId) {
        if (!cancelled) {
          setNotifications([])
          setUnreadCount(0)
          setLoading(false)
        }
        return
      }

      setLoading(true)
      try {
        const res = await fetch(`/api/notifications?limit=${DEFAULT_LIMIT}`, { cache: 'no-store' })
        if (!res.ok) return
        const body = (await res.json()) as {
          notifications?: NotificationRecord[]
          unreadCount?: number
        }
        if (cancelled) return
        setNotifications(Array.isArray(body.notifications) ? body.notifications : [])
        setUnreadCount(typeof body.unreadCount === 'number' ? body.unreadCount : 0)
      } catch {
        if (!cancelled) {
          setNotifications([])
          setUnreadCount(0)
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    void loadNotifications()
    return () => {
      cancelled = true
    }
  }, [userId, orgId, pathname])

  useEffect(() => {
    if (!userId) return

    const ws = new WebSocket(
      `${resolveSyncUrl()}/${encodeURIComponent(`__notifications__:${userId}`)}`,
    )
    ws.binaryType = 'arraybuffer'

    ws.onmessage = async (event) => {
      const arrayBuffer =
        event.data instanceof ArrayBuffer ? event.data : await event.data.arrayBuffer()
      const decoder = decoding.createDecoder(new Uint8Array(arrayBuffer))
      const messageType = decoding.readVarUint(decoder)
      if (messageType !== messageNotification) return

      const payload = JSON.parse(decoding.readVarString(decoder)) as NotificationRealtimeEvent

      if (payload.kind === 'notification.created') {
        if (orgId && payload.notification.orgId !== orgId) return
        setNotifications((current) => [payload.notification, ...current].slice(0, DEFAULT_LIMIT))
        if (!payload.notification.read) {
          setUnreadCount((current) => current + 1)
        }
        return
      }

      if (payload.kind === 'notification.read') {
        setNotifications((current) => {
          const next = setNotificationReadState(current, payload.ids)
          setUnreadCount((count) => Math.max(0, count - next.markedUnreadCount))
          return next.notifications
        })
        return
      }

      setNotifications((current) =>
        current.map((notification) => ({ ...notification, read: true })),
      )
      setUnreadCount(0)
    }

    return () => {
      ws.close()
    }
  }, [userId, orgId])

  const handleNotificationClick = async (notification: NotificationRecord) => {
    setOpen(false)

    if (!notification.read) {
      const next = setNotificationReadState(notifications, [notification.id])
      setNotifications(next.notifications)
      setUnreadCount((count) => Math.max(0, count - next.markedUnreadCount))
      void fetch(`/api/notifications/${notification.id}`, {
        method: 'PATCH',
      })
    }

    router.push(getNotificationHref(notification))
    onNavigate?.()
  }

  const handleReadAll = async () => {
    if (markingAll || unreadCount === 0) return

    setMarkingAll(true)
    setNotifications((current) => current.map((notification) => ({ ...notification, read: true })))
    setUnreadCount(0)
    try {
      await fetch('/api/notifications/read-all', {
        method: 'POST',
      })
    } finally {
      setMarkingAll(false)
    }
  }

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="relative rounded border border-border-strong bg-bg p-1.5 text-fg-muted hover:border-fg hover:text-fg"
        aria-label="Notifications"
        aria-expanded={open}
      >
        <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={1.5}
            d="M14.857 17.082a23.848 23.848 0 005.454-1.31A8.967 8.967 0 0118 9.75V9a6 6 0 10-12 0v.75a8.967 8.967 0 01-2.312 6.022c1.733.64 3.56 1.082 5.455 1.31m5.714 0a24.255 24.255 0 01-5.714 0m5.714 0a3 3 0 11-5.714 0"
          />
        </svg>
        {unreadCount > 0 && (
          <span className="absolute -right-1.5 -top-1.5 min-w-[18px] rounded-full bg-accent px-1.5 py-0.5 text-center font-mono text-[10px] font-semibold leading-none text-white">
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-[calc(100%+8px)] z-[70] w-[320px] rounded border border-border bg-bg shadow-lg">
          <div className="flex items-center justify-between border-b border-border px-3 py-2">
            <div>
              <p className="text-[13px] font-semibold text-fg">Notifications</p>
              <p className="font-mono text-[11px] text-fg-muted">{unreadCount} unread</p>
            </div>
            <button
              type="button"
              onClick={() => void handleReadAll()}
              disabled={markingAll || unreadCount === 0}
              className="font-mono text-[11px] text-fg-muted hover:text-fg disabled:opacity-50"
            >
              {markingAll ? '...' : 'mark all read'}
            </button>
          </div>

          <div className="max-h-[360px] overflow-y-auto">
            {loading ? (
              <div className="px-3 py-4 font-mono text-[11px] text-fg-muted">Loading...</div>
            ) : notifications.length === 0 ? (
              <div className="px-3 py-4 font-mono text-[11px] text-fg-muted">
                No notifications yet.
              </div>
            ) : (
              notifications.map((notification) => (
                <button
                  key={notification.id}
                  type="button"
                  onClick={() => void handleNotificationClick(notification)}
                  className={`flex w-full items-start gap-3 border-b border-border px-3 py-3 text-left last:border-b-0 hover:bg-bg-subtle ${
                    notification.read ? '' : 'bg-bg-subtle'
                  }`}
                >
                  <span
                    className={`mt-1 h-2.5 w-2.5 shrink-0 rounded-full ${
                      notification.read ? 'bg-border' : 'bg-accent'
                    }`}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-start justify-between gap-3">
                      <span className="text-[13px] font-medium text-fg">{notification.title}</span>
                      <span className="shrink-0 font-mono text-[10px] text-fg-muted">
                        {relativeTime(notification.createdAt)}
                      </span>
                    </span>
                    <span className="mt-1 block text-[12px] leading-5 text-fg-secondary">
                      {notification.body}
                    </span>
                  </span>
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  )
}
