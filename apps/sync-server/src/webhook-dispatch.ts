import crypto from 'node:crypto'

export const DELIVERY_RETRY_DELAYS_MS = [1_000, 10_000, 60_000] as const
const MAX_DELIVERY_ATTEMPTS = DELIVERY_RETRY_DELAYS_MS.length + 1

export interface WebhookDeliveryTarget {
  id: string
  url: string
  secret: string
}

export interface RecordWebhookDeliveryInput {
  webhookId: string
  eventType: string
  payload: string
  statusCode: number | null
  responseBody: string
  attemptCount: number
}

export interface DispatchWebhookWithRetryInput {
  webhook: WebhookDeliveryTarget
  eventType: string
  payloadObject: Record<string, unknown>
  attempt?: number
}

export interface WebhookDispatchDeps {
  fetchFn?: typeof fetch
  scheduleFn?: (handler: () => void, delayMs: number) => unknown
  recordDelivery: (input: RecordWebhookDeliveryInput) => Promise<void> | void
}

interface ParseWebhookEventsOptions {
  onInvalidJson?: (value: string) => void
}

export function parseWebhookEvents(value: string, options?: ParseWebhookEventsOptions): string[] {
  try {
    const parsed = JSON.parse(value)
    if (!Array.isArray(parsed)) return []
    return parsed.filter((entry): entry is string => typeof entry === 'string')
  } catch {
    options?.onInvalidJson?.(value)
    return []
  }
}

export function webhookSubscribedToEvent(
  events: string,
  eventType: string,
  options?: ParseWebhookEventsOptions,
): boolean {
  return parseWebhookEvents(events, options).includes(eventType)
}

export function buildWebhookSignature(secret: string, payload: string): string {
  return crypto.createHmac('sha256', secret).update(payload).digest('hex')
}

export function createConcurrencyLimitedFetch(
  maxConcurrency: number,
  fetchFn: typeof fetch = fetch,
): typeof fetch {
  const limit = Math.max(1, Math.trunc(maxConcurrency) || 1)
  let active = 0
  const queue: Array<() => void> = []

  const runNext = () => {
    if (active >= limit) return
    const next = queue.shift()
    if (!next) return
    active += 1
    next()
  }

  const wrapped = ((...args: Parameters<typeof fetch>) =>
    new Promise<Response>((resolve, reject) => {
      queue.push(() => {
        void fetchFn(...args)
          .then(resolve, reject)
          .finally(() => {
            active = Math.max(0, active - 1)
            runNext()
          })
      })
      runNext()
    })) as typeof fetch

  return wrapped
}

export function dispatchWebhookWithRetry(
  input: DispatchWebhookWithRetryInput,
  deps: WebhookDispatchDeps,
): void {
  const fetchFn = deps.fetchFn ?? fetch
  const scheduleFn =
    deps.scheduleFn ?? ((handler: () => void, delayMs: number) => setTimeout(handler, delayMs))
  const attempt = input.attempt ?? 1
  const payload = JSON.stringify(input.payloadObject)
  const signature = buildWebhookSignature(input.webhook.secret, payload)

  void (async () => {
    let statusCode: number | null = null
    let responseBody = ''
    let success = false

    try {
      const res = await fetchFn(input.webhook.url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-CollabMD-Signature': signature,
        },
        body: payload,
      })
      statusCode = res.status
      responseBody = (await res.text()).slice(0, 5_000)
      success = res.ok
    } catch (error) {
      responseBody = error instanceof Error ? error.message : 'request failed'
    }

    await deps.recordDelivery({
      webhookId: input.webhook.id,
      eventType: input.eventType,
      payload,
      statusCode,
      responseBody,
      attemptCount: attempt,
    })

    if (success || attempt >= MAX_DELIVERY_ATTEMPTS) return
    const delay =
      DELIVERY_RETRY_DELAYS_MS[attempt - 1] ??
      DELIVERY_RETRY_DELAYS_MS[DELIVERY_RETRY_DELAYS_MS.length - 1]
    scheduleFn(() => {
      dispatchWebhookWithRetry(
        {
          webhook: input.webhook,
          eventType: input.eventType,
          payloadObject: input.payloadObject,
          attempt: attempt + 1,
        },
        deps,
      )
    }, delay)
  })()
}
