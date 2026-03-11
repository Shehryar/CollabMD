import type { NotificationRecord } from '@collabmd/shared'

export function getNotificationHref(notification: NotificationRecord): string {
  if (notification.resourceType === 'document') {
    return `/doc/${notification.resourceId}`
  }

  if (notification.resourceType === 'folder') {
    return `/?folder=${encodeURIComponent(notification.resourceId)}`
  }

  return '/'
}
