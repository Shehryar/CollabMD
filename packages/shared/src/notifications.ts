export const notificationTypes = [
  'share_invite',
  'document_comment',
  'comment_reply',
  'suggestion_pending',
  'mention',
] as const

export type NotificationType = (typeof notificationTypes)[number]

export const notificationResourceTypes = ['document', 'folder', 'organization'] as const

export type NotificationResourceType = (typeof notificationResourceTypes)[number]

export interface NotificationRecord {
  id: string
  userId: string
  orgId: string
  type: NotificationType
  title: string
  body: string
  resourceId: string
  resourceType: NotificationResourceType
  read: boolean
  createdAt: string
}

export type NotificationRealtimeEvent =
  | {
      kind: 'notification.created'
      notification: NotificationRecord
    }
  | {
      kind: 'notification.read'
      ids: string[]
    }
  | {
      kind: 'notification.read_all'
    }
