import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { rateLimit } from './rate-limit'

// Use unique keys per test to avoid cross-contamination from the shared
// module-level Map store.
let keyCounter = 0
function uniqueKey(label: string): string {
  return `test-${label}-${keyCounter++}`
}

describe('rateLimit', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('first request for a new key succeeds with remaining = maxTokens - 1', () => {
    const key = uniqueKey('first-request')
    const result = rateLimit(key, 5, 10_000)

    expect(result.success).toBe(true)
    expect(result.remaining).toBe(4)
  })

  it('consuming all tokens exhausts the bucket', () => {
    const key = uniqueKey('exhaust')
    const maxTokens = 3

    // Consume all 3 tokens
    rateLimit(key, maxTokens, 10_000) // remaining 2
    rateLimit(key, maxTokens, 10_000) // remaining 1
    rateLimit(key, maxTokens, 10_000) // remaining 0

    // 4th request should fail
    const result = rateLimit(key, maxTokens, 10_000)
    expect(result.success).toBe(false)
    expect(result.remaining).toBe(0)
  })

  it('different keys have independent buckets', () => {
    const keyA = uniqueKey('independent-a')
    const keyB = uniqueKey('independent-b')

    // Exhaust keyA (2 tokens)
    rateLimit(keyA, 2, 10_000)
    rateLimit(keyA, 2, 10_000)
    const exhausted = rateLimit(keyA, 2, 10_000)
    expect(exhausted.success).toBe(false)

    // keyB should still work
    const resultB = rateLimit(keyB, 2, 10_000)
    expect(resultB.success).toBe(true)
    expect(resultB.remaining).toBe(1)
  })

  it('tokens refill after the window elapses', () => {
    const key = uniqueKey('refill')
    const maxTokens = 2
    const windowMs = 10_000

    // Consume all tokens
    rateLimit(key, maxTokens, windowMs)
    rateLimit(key, maxTokens, windowMs)
    const exhausted = rateLimit(key, maxTokens, windowMs)
    expect(exhausted.success).toBe(false)

    // Advance time past one full window
    vi.advanceTimersByTime(windowMs)

    // Should succeed again after refill
    const result = rateLimit(key, maxTokens, windowMs)
    expect(result.success).toBe(true)
  })

  it('remaining count decreases with each request', () => {
    const key = uniqueKey('decreasing')
    const maxTokens = 5
    const windowMs = 10_000

    const r1 = rateLimit(key, maxTokens, windowMs)
    expect(r1.remaining).toBe(4)

    const r2 = rateLimit(key, maxTokens, windowMs)
    expect(r2.remaining).toBe(3)

    const r3 = rateLimit(key, maxTokens, windowMs)
    expect(r3.remaining).toBe(2)

    const r4 = rateLimit(key, maxTokens, windowMs)
    expect(r4.remaining).toBe(1)

    const r5 = rateLimit(key, maxTokens, windowMs)
    expect(r5.remaining).toBe(0)
  })

  it('after exhaustion and window elapsed, requests succeed again', () => {
    const key = uniqueKey('exhaust-then-refill')
    const maxTokens = 2
    const windowMs = 5_000

    // Exhaust
    rateLimit(key, maxTokens, windowMs)
    rateLimit(key, maxTokens, windowMs)
    const exhausted = rateLimit(key, maxTokens, windowMs)
    expect(exhausted.success).toBe(false)
    expect(exhausted.remaining).toBe(0)

    // Advance past the window
    vi.advanceTimersByTime(windowMs)

    // Should succeed with a full bucket again
    const result = rateLimit(key, maxTokens, windowMs)
    expect(result.success).toBe(true)
    expect(result.remaining).toBeGreaterThan(0)
  })

  it('partial window elapsed does not refill tokens', () => {
    const key = uniqueKey('partial-window')
    const maxTokens = 2
    const windowMs = 10_000

    // Exhaust all tokens
    rateLimit(key, maxTokens, windowMs)
    rateLimit(key, maxTokens, windowMs)
    const exhausted = rateLimit(key, maxTokens, windowMs)
    expect(exhausted.success).toBe(false)

    // Advance only half the window
    vi.advanceTimersByTime(windowMs / 2)

    // Should still be exhausted (Math.floor(5000/10000) = 0 refills)
    const result = rateLimit(key, maxTokens, windowMs)
    expect(result.success).toBe(false)
    expect(result.remaining).toBe(0)
  })
})
