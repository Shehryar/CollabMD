/**
 * WebMCP dev tools for AI agent testing.
 * Registers structured tools via navigator.modelContext (Chrome 146+, WebMCP flag).
 * Only loaded in development — see DevToolsProvider.
 */

interface ToolDef {
  name: string
  description: string
  inputSchema: Record<string, unknown>
  handler: (input: Record<string, unknown>) => Promise<unknown>
}

interface ModelContext {
  registerTool: (tool: ToolDef) => void
}

declare global {
  interface Navigator {
    modelContext?: ModelContext
  }
}

function getAllCollabmdKeys(): string[] {
  const keys: string[] = []
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i)
    if (key?.startsWith('collabmd:')) keys.push(key)
  }
  return keys
}

function getOrgId(): string | null {
  // Read from the DOM — the sidebar context stores it on the session
  const match = document.cookie.match(/active_organization=([^;]+)/)
  if (match) return decodeURIComponent(match[1])

  // Fallback: scan localStorage keys for any orgId pattern
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i)
    const m = key?.match(/^collabmd:onboarding-path:(.+)$/)
    if (m) return m[1]
  }

  // Last resort: look for the onboarding status data attribute
  const el = document.querySelector('[data-org-id]')
  return el?.getAttribute('data-org-id') ?? null
}

const tools: ToolDef[] = [
  {
    name: 'get_onboarding_state',
    description:
      'Returns onboarding state from localStorage: chosen path (web/local), completed, dismissed, CLI installed, folder linked. Pass orgId or it will be auto-detected.',
    inputSchema: {
      type: 'object',
      properties: {
        orgId: { type: 'string', description: 'Organization ID. Auto-detected if omitted.' },
      },
    },
    handler: async (input) => {
      const orgId = (input.orgId as string) || getOrgId()
      if (!orgId) return { error: 'No orgId found. Pass it explicitly or sign in first.' }

      return {
        orgId,
        path: localStorage.getItem(`collabmd:onboarding-path:${orgId}`) ?? 'not set',
        completed: localStorage.getItem(`collabmd:onboarding-completed:${orgId}`) === '1',
        dismissed: localStorage.getItem(`collabmd:getting-started:dismissed:${orgId}`) === '1',
        firstSeen: localStorage.getItem(`collabmd:getting-started:first-seen:${orgId}`),
        cliInstalled: localStorage.getItem(`collabmd:connect:cli-installed:${orgId}`) === '1',
        folderLinked: localStorage.getItem(`collabmd:connect:folder-linked:${orgId}`) === '1',
      }
    },
  },

  {
    name: 'reset_onboarding',
    description:
      'Clears all onboarding-related localStorage keys for the given org (or all orgs if no orgId). Dispatches storage event so components re-render.',
    inputSchema: {
      type: 'object',
      properties: {
        orgId: {
          type: 'string',
          description: 'Organization ID. If omitted, clears all collabmd keys.',
        },
      },
    },
    handler: async (input) => {
      const orgId = input.orgId as string | undefined
      const removed: string[] = []

      if (orgId) {
        const prefixes = [
          `collabmd:onboarding-path:${orgId}`,
          `collabmd:onboarding-completed:${orgId}`,
          `collabmd:getting-started:dismissed:${orgId}`,
          `collabmd:getting-started:first-seen:${orgId}`,
          `collabmd:connect:cli-installed:${orgId}`,
          `collabmd:connect:folder-linked:${orgId}`,
        ]
        for (const key of prefixes) {
          if (localStorage.getItem(key) !== null) {
            localStorage.removeItem(key)
            removed.push(key)
          }
        }
      } else {
        for (const key of getAllCollabmdKeys()) {
          localStorage.removeItem(key)
          removed.push(key)
        }
      }

      window.dispatchEvent(new Event('storage'))
      return { removed, count: removed.length }
    },
  },

  {
    name: 'set_onboarding_path',
    description: 'Set the onboarding path to "web" or "local" for testing checklist behavior.',
    inputSchema: {
      type: 'object',
      properties: {
        orgId: { type: 'string', description: 'Organization ID. Auto-detected if omitted.' },
        path: { type: 'string', enum: ['web', 'local'], description: 'Onboarding path to set.' },
      },
      required: ['path'],
    },
    handler: async (input) => {
      const orgId = (input.orgId as string) || getOrgId()
      if (!orgId) return { error: 'No orgId found.' }

      localStorage.setItem(`collabmd:onboarding-path:${orgId}`, input.path as string)
      window.dispatchEvent(new Event('storage'))
      return { orgId, path: input.path }
    },
  },

  {
    name: 'get_sidebar_state',
    description:
      'Reads the rendered sidebar DOM and returns structured data: visible nav links, checklist items with checked state, connect link presence.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
    handler: async () => {
      const sidebar = document.querySelector('aside[aria-label="sidebar"]')
      if (!sidebar) return { error: 'Sidebar not found in DOM.' }

      // Nav links
      const nav = sidebar.querySelector('nav[aria-label="primary"]')
      const links = Array.from(nav?.querySelectorAll('a') ?? []).map((a) => ({
        label: a.textContent?.trim() ?? '',
        href: a.getAttribute('href') ?? '',
        active: a.className.includes('shadow-sm'),
      }))

      // Checklist
      const checklistSection = sidebar.querySelector('section')
      let checklist = null
      if (checklistSection) {
        const heading = checklistSection.querySelector('h3')?.textContent?.trim()
        const progressText = checklistSection.querySelector('p.font-mono')?.textContent?.trim()
        const items = Array.from(checklistSection.querySelectorAll('li')).map((li) => {
          const checkbox = li.querySelector('span')
          const checked = checkbox?.className.includes('bg-accent') ?? false
          const label = li.textContent?.trim() ?? ''
          return { label, checked }
        })
        checklist = { heading, progressText, items }
      }

      // Connect prompt (the subtle "want to edit locally too?" line)
      const connectPrompt = sidebar.querySelector('p.font-sans.text-fg-muted')
      const connectPromptVisible = connectPrompt?.textContent?.includes('edit locally') ?? false

      return { links, checklist, connectPromptVisible }
    },
  },

  {
    name: 'get_page_state',
    description:
      'Returns current page URL, title, and whether any modal/wizard overlay is visible.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
    handler: async () => {
      const overlay = document.querySelector('.fixed.inset-0.z-\\[80\\]')
      const wizardHeading = overlay?.querySelector('h2')?.textContent?.trim()

      return {
        url: window.location.href,
        pathname: window.location.pathname,
        title: document.title,
        wizardOpen: overlay !== null,
        wizardStep: wizardHeading ?? null,
      }
    },
  },

  {
    name: 'get_documents',
    description: 'Fetches the documents list from /api/documents for the current org.',
    inputSchema: {
      type: 'object',
      properties: {
        orgId: { type: 'string', description: 'Organization ID. Auto-detected if omitted.' },
      },
    },
    handler: async (input) => {
      const orgId = (input.orgId as string) || getOrgId()
      if (!orgId) return { error: 'No orgId found.' }

      const res = await fetch(`/api/documents?orgId=${orgId}`)
      if (!res.ok) return { error: `API returned ${res.status}` }
      const docs = await res.json()
      return { orgId, count: docs.length, documents: docs }
    },
  },

  {
    name: 'get_folders',
    description: 'Fetches the folder list from /api/folders for the current org.',
    inputSchema: {
      type: 'object',
      properties: {
        orgId: { type: 'string', description: 'Organization ID. Auto-detected if omitted.' },
      },
    },
    handler: async (input) => {
      const orgId = (input.orgId as string) || getOrgId()
      if (!orgId) return { error: 'No orgId found.' }

      const res = await fetch(`/api/folders?orgId=${orgId}`)
      if (!res.ok) return { error: `API returned ${res.status}` }
      const folders = await res.json()
      return { orgId, count: folders.length, folders }
    },
  },
]

export function registerDevTools(): boolean {
  if (!navigator.modelContext) {
    console.log(
      '[webmcp] navigator.modelContext not available. Enable WebMCP flag in chrome://flags.',
    )
    return false
  }

  for (const tool of tools) {
    navigator.modelContext.registerTool(tool)
  }

  console.log(`[webmcp] Registered ${tools.length} dev tools.`)
  return true
}
