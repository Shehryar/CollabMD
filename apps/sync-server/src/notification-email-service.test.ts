import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mockGetPreferences = vi.fn()
const mockAll = vi.fn()
const mockWhere = vi.fn(() => ({ all: mockAll }))
const mockFrom = vi.fn(() => ({ where: mockWhere }))

vi.mock('@collabmd/db', () => ({
  db: {
    select: vi.fn(() => ({ from: mockFrom })),
  },
  getUserEmailNotificationPreferences: (...args: unknown[]) =>
    mockGetPreferences.apply(undefined, args as never),
  users: {
    id: 'id',
    email: 'email',
  },
  inArray: vi.fn((column: unknown, values: unknown) => ({ column, values })),
}))

vi.mock('@collabmd/shared', () => ({
  shouldSendNotificationEmail: (preference: 'all' | 'mentions' | 'none', kind: 'mention') => {
    if (preference === 'none') return false
    if (preference === 'all') return true
    return kind === 'mention'
  },
  buildCommentMentionEmail: (input: {
    actorName: string
    documentTitle: string
    excerpt: string
    documentUrl: string
    preferencesUrl: string
  }) => ({
    subject: `${input.actorName} mentioned you in ${input.documentTitle}`,
    text: `${input.excerpt}\n${input.documentUrl}\n${input.preferencesUrl}`,
    html: `<p>${input.actorName}</p>`,
  }),
}))

import { buildMentionEmailPayloads, sendMentionEmails } from './notification-email-service.js'

describe('sendMentionEmails', () => {
  const originalEnv = {
    BETTER_AUTH_URL: process.env.BETTER_AUTH_URL,
    RESEND_API_KEY: process.env.RESEND_API_KEY,
    RESEND_FROM_EMAIL: process.env.RESEND_FROM_EMAIL,
  }
  const originalFetch = globalThis.fetch

  beforeEach(() => {
    vi.clearAllMocks()
    mockGetPreferences.mockReturnValue(
      new Map([
        ['user-1', 'all'],
        ['user-2', 'mentions'],
        ['user-3', 'none'],
      ]),
    )
    mockAll.mockReturnValue([
      { id: 'user-1', email: 'all@example.com' },
      { id: 'user-2', email: 'mentions@example.com' },
      { id: 'user-3', email: 'none@example.com' },
    ])
    process.env.BETTER_AUTH_URL = 'https://collabmd.test'
    process.env.RESEND_API_KEY = 'resend_test_key'
    process.env.RESEND_FROM_EMAIL = 'CollabMD <notifications@example.com>'
    globalThis.fetch = vi.fn(async () => ({
      ok: true,
      text: async () => '',
    })) as unknown as typeof fetch
  })

  afterEach(() => {
    process.env.BETTER_AUTH_URL = originalEnv.BETTER_AUTH_URL
    process.env.RESEND_API_KEY = originalEnv.RESEND_API_KEY
    process.env.RESEND_FROM_EMAIL = originalEnv.RESEND_FROM_EMAIL
    globalThis.fetch = originalFetch
  })

  it('builds mention emails only for allowed recipients', () => {
    const payloads = buildMentionEmailPayloads({
      userIds: ['user-1', 'user-2', 'user-3'],
      actorName: 'Alice',
      documentId: 'doc-1',
      documentTitle: 'Roadmap',
      excerpt: '@alice can you review this?',
    })

    expect(mockGetPreferences).toHaveBeenCalledWith(['user-1', 'user-2', 'user-3'])
    expect(payloads).toHaveLength(2)
    expect(payloads[0]).toEqual(
      expect.objectContaining({
        to: 'all@example.com',
        subject: 'Alice mentioned you in Roadmap',
      }),
    )
    expect(payloads[1]).toEqual(
      expect.objectContaining({
        to: 'mentions@example.com',
        subject: 'Alice mentioned you in Roadmap',
      }),
    )
    expect(payloads[0]?.text).toContain('https://collabmd.test/doc/doc-1')
    expect(payloads[0]?.text).toContain('https://collabmd.test/settings/notifications')
  })

  it('skips work when there are no recipients', async () => {
    expect(
      buildMentionEmailPayloads({
        userIds: [],
        actorName: 'Alice',
        documentId: 'doc-1',
        documentTitle: 'Roadmap',
        excerpt: 'Ping',
      }),
    ).toEqual([])

    await sendMentionEmails({
      userIds: [],
      actorName: 'Alice',
      documentId: 'doc-1',
      documentTitle: 'Roadmap',
      excerpt: 'Ping',
    })

    expect(mockGetPreferences).not.toHaveBeenCalled()
    expect(fetch).not.toHaveBeenCalled()
  })
})
