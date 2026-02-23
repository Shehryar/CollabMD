export const webhookEventTypes = [
  'document.edited',
  'comment.created',
  'comment.mention',
  'suggestion.created',
  'suggestion.accepted',
  'suggestion.dismissed',
  'discussion.created',
] as const

export type WebhookEventType = (typeof webhookEventTypes)[number]

export interface WebhookEventPayload {
  eventType: WebhookEventType
  documentId: string
  orgId: string
  actorId: string | null
  actorSource: 'browser' | 'daemon' | 'api' | 'agent'
  timestamp: string
  data?: Record<string, unknown>
}
