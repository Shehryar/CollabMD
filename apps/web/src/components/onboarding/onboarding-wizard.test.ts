// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { OnboardingWizard } from './onboarding-wizard'

const pushMock = vi.fn()
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: pushMock }),
}))

const inviteMemberMock = vi.fn(async () => ({ error: null }))
const updateMock = vi.fn(async () => ({ error: undefined }))
vi.mock('@/lib/auth-client', () => ({
  authClient: {
    organization: {
      inviteMember: (...args: unknown[]) => inviteMemberMock.apply(undefined, args as never),
      update: (...args: unknown[]) => updateMock.apply(undefined, args as never),
    },
  },
}))

describe('OnboardingWizard', () => {
  let container: HTMLDivElement | null = null
  let root: Root | null = null
  const fetchMock = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    vi.stubGlobal('fetch', fetchMock)
    const storage = new Map<string, string>()
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => {
        storage.set(key, value)
      },
      removeItem: (key: string) => {
        storage.delete(key)
      },
      clear: () => {
        storage.clear()
      },
    })

    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(async () => {
    if (root) {
      await act(async () => {
        root?.unmount()
      })
    }
    if (container) {
      container.remove()
    }
    root = null
    container = null
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = false
    vi.unstubAllGlobals()
  })

  async function renderWizard(onClose = vi.fn()) {
    await act(async () => {
      root?.render(
        createElement(OnboardingWizard, {
          open: true,
          orgId: 'org-1',
          orgName: 'Workspace',
          onClose,
          onRefreshStatus: async () => {},
        }),
      )
    })
    return onClose
  }

  function requireButton(text: string): HTMLButtonElement {
    const button = Array.from(container?.querySelectorAll('button') ?? []).find((entry) =>
      entry.textContent?.includes(text),
    )
    if (!button) throw new Error(`button "${text}" not found`)
    return button as HTMLButtonElement
  }

  async function clickButton(text: string) {
    const button = requireButton(text)
    await act(async () => {
      button.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
  }

  async function navigateToInviteStep() {
    await clickButton('Write in the browser')
    await clickButton('Skip')
    expect(container?.textContent).toContain('Invite your team')
  }

  it('allows skipping invite step without creating a starter document', async () => {
    const onClose = await renderWizard()
    await navigateToInviteStep()

    await clickButton('Skip')

    expect(onClose).toHaveBeenCalledOnce()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('closes onboarding when finish is clicked even if document creation fails', async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 500 }))
    const onClose = await renderWizard()
    await navigateToInviteStep()

    await clickButton('Finish')

    expect(fetchMock).toHaveBeenCalledOnce()
    expect(onClose).toHaveBeenCalledOnce()
    expect(pushMock).not.toHaveBeenCalled()
  })

  it('navigates to the created starter document when creation succeeds', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ id: 'doc-123' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    )
    const onClose = await renderWizard()
    await navigateToInviteStep()

    await clickButton('Finish')

    expect(onClose).toHaveBeenCalledOnce()
    expect(pushMock).toHaveBeenCalledWith('/doc/doc-123')
  })
})
