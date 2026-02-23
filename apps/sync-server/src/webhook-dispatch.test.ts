import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  buildWebhookSignature,
  createConcurrencyLimitedFetch,
  dispatchWebhookWithRetry,
  webhookSubscribedToEvent,
} from './webhook-dispatch.js'

describe('webhook dispatch helpers', () => {
  afterEach(() => {
    vi.useRealTimers()
    vi.clearAllMocks()
  })

  it('builds deterministic HMAC-SHA256 signatures', () => {
    const payload = JSON.stringify({ eventType: 'document.edited', documentId: 'doc-1' })
    const signatureA = buildWebhookSignature('top-secret', payload)
    const signatureB = buildWebhookSignature('top-secret', payload)
    const signatureC = buildWebhookSignature('different-secret', payload)

    expect(signatureA).toBe(signatureB)
    expect(signatureA).not.toBe(signatureC)
    expect(signatureA).toMatch(/^[a-f0-9]{64}$/)
  })

  it('filters webhook events by subscription payload', () => {
    expect(webhookSubscribedToEvent(JSON.stringify(['comment.created', 'discussion.created']), 'discussion.created')).toBe(true)
    expect(webhookSubscribedToEvent(JSON.stringify(['comment.created']), 'discussion.created')).toBe(false)
    expect(webhookSubscribedToEvent('not-json', 'discussion.created')).toBe(false)
  })

  it('invokes parse-error callback for malformed webhook event JSON', () => {
    const onInvalidJson = vi.fn()
    expect(webhookSubscribedToEvent('not-json', 'discussion.created', { onInvalidJson })).toBe(false)
    expect(onInvalidJson).toHaveBeenCalledOnce()
  })

  it('retries failed deliveries with 1s, 10s, and 60s backoff', async () => {
    vi.useFakeTimers()
    const flushAsync = async () => {
      for (let i = 0; i < 6; i += 1) {
        await Promise.resolve()
      }
    }

    const fetchFn = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      text: async () => 'server error',
    } satisfies Pick<Response, 'ok' | 'status' | 'text'>)
    const recordDelivery = vi.fn(async () => {})
    const scheduleFn = vi.fn((handler: () => void, delayMs: number) => setTimeout(handler, delayMs))

    dispatchWebhookWithRetry(
      {
        webhook: { id: 'wh-1', url: 'https://example.test/webhook', secret: 'secret' },
        eventType: 'document.edited',
        payloadObject: { eventType: 'document.edited', documentId: 'doc-1' },
      },
      { fetchFn: fetchFn as unknown as typeof fetch, scheduleFn, recordDelivery },
    )

    await flushAsync()
    expect(fetchFn).toHaveBeenCalledTimes(1)
    expect(recordDelivery).toHaveBeenCalledTimes(1)
    expect(scheduleFn).toHaveBeenNthCalledWith(1, expect.any(Function), 1_000)

    await vi.advanceTimersByTimeAsync(1_000)
    await flushAsync()
    expect(fetchFn).toHaveBeenCalledTimes(2)
    expect(recordDelivery).toHaveBeenCalledTimes(2)
    expect(scheduleFn).toHaveBeenNthCalledWith(2, expect.any(Function), 10_000)

    await vi.advanceTimersByTimeAsync(10_000)
    await flushAsync()
    expect(fetchFn).toHaveBeenCalledTimes(3)
    expect(recordDelivery).toHaveBeenCalledTimes(3)
    expect(scheduleFn).toHaveBeenNthCalledWith(3, expect.any(Function), 60_000)

    await vi.advanceTimersByTimeAsync(60_000)
    await flushAsync()
    expect(fetchFn).toHaveBeenCalledTimes(4)
    expect(recordDelivery).toHaveBeenCalledTimes(4)
    expect(scheduleFn).toHaveBeenCalledTimes(3)
  })

  it('limits webhook fetch concurrency', async () => {
    const flushAsync = async () => {
      for (let i = 0; i < 6; i += 1) {
        await Promise.resolve()
      }
    }
    let active = 0
    let peak = 0
    const resolvers: Array<() => void> = []

    const baseFetch = vi.fn(() => new Promise<Response>((resolve) => {
      active += 1
      peak = Math.max(peak, active)
      resolvers.push(() => {
        active -= 1
        resolve({
          ok: true,
          status: 200,
          text: async () => 'ok',
        } as Response)
      })
    }))

    const limitedFetch = createConcurrencyLimitedFetch(2, baseFetch as unknown as typeof fetch)
    const pending = [
      limitedFetch('https://example.test/1'),
      limitedFetch('https://example.test/2'),
      limitedFetch('https://example.test/3'),
      limitedFetch('https://example.test/4'),
    ]

    await flushAsync()
    expect(baseFetch).toHaveBeenCalledTimes(2)
    expect(peak).toBe(2)

    resolvers.shift()?.()
    await flushAsync()
    expect(baseFetch).toHaveBeenCalledTimes(3)
    expect(peak).toBe(2)

    resolvers.shift()?.()
    await flushAsync()
    expect(baseFetch).toHaveBeenCalledTimes(4)
    expect(peak).toBe(2)

    while (resolvers.length > 0) {
      resolvers.shift()?.()
    }
    await Promise.all(pending)
  })
})
