import { randomBytes } from 'crypto'
import { glob } from 'fs/promises'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { basename, join, relative, resolve } from 'path'
import { createInterface } from 'readline/promises'
import open from 'open'
import { getCredential, saveCredential, startLoginServer, type Credential } from '../auth/index.js'

type StepName = 'project' | 'server' | 'auth' | 'workspace' | 'invite' | 'scan' | 'background'

export interface OnboardingOptions {
  argv?: string[]
  cwdMode?: boolean
  rootDir?: string
  defaultServerUrl?: string
  defaultOrgId?: string
  fetchImpl?: typeof fetch
  openBrowser?: (url: string) => Promise<void>
}

interface ParsedArgs {
  projectName?: string
  skip: Set<StepName>
}

interface OrganizationSummary {
  id: string
  name: string
}

class UserCancelledError extends Error {
  constructor() {
    super('cancelled')
  }
}

function parseArgs(argv: string[]): ParsedArgs {
  const skip = new Set<StepName>()
  let projectName: string | undefined

  const markSkip = (value: string) => {
    if (value === 'all') {
      skip.add('project')
      skip.add('server')
      skip.add('auth')
      skip.add('workspace')
      skip.add('invite')
      skip.add('scan')
      skip.add('background')
      return
    }
    if (value === 'invites') value = 'invite'
    if (value === 'step5') value = 'invite'
    if (value === 'step7') value = 'background'
    if (
      value === 'project' ||
      value === 'server' ||
      value === 'auth' ||
      value === 'workspace' ||
      value === 'invite' ||
      value === 'scan' ||
      value === 'background'
    ) {
      skip.add(value)
    }
  }

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === '--skip') {
      markSkip('all')
      continue
    }
    if (arg.startsWith('--skip=')) {
      const values = arg.slice('--skip='.length).split(',')
      for (const value of values) markSkip(value.trim())
      continue
    }
    if (arg.startsWith('--skip-')) {
      markSkip(arg.slice('--skip-'.length).trim())
      continue
    }
    if (!arg.startsWith('-') && !projectName) {
      projectName = arg
    }
  }

  return { projectName, skip }
}

function loadConfig(configPath: string): Record<string, unknown> {
  if (!existsSync(configPath)) return {}
  try {
    return JSON.parse(readFileSync(configPath, 'utf-8')) as Record<string, unknown>
  } catch {
    return {}
  }
}

function saveConfig(configPath: string, config: Record<string, unknown>): void {
  writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n')
}

function splitEmails(value: string): string[] {
  return value
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)
}

function extractOrganizations(payload: unknown): OrganizationSummary[] {
  if (Array.isArray(payload)) {
    return payload
      .filter((entry): entry is OrganizationSummary => {
        if (!entry || typeof entry !== 'object') return false
        const candidate = entry as { id?: unknown; name?: unknown }
        return typeof candidate.id === 'string' && typeof candidate.name === 'string'
      })
      .map((entry) => ({ id: entry.id, name: entry.name }))
  }

  if (payload && typeof payload === 'object') {
    const value = payload as { organizations?: unknown }
    return extractOrganizations(value.organizations)
  }

  return []
}

async function scanMarkdownFiles(projectDir: string): Promise<string[]> {
  const results: string[] = []
  for await (const file of glob('**/*.md', {
    cwd: projectDir,
    exclude: ['node_modules/**', '.git/**', '.collabmd/**'],
  })) {
    results.push(file)
  }
  return results
}

export async function runOnboardingFlow(options: OnboardingOptions = {}): Promise<void> {
  const argv = options.argv ?? []
  const parsed = parseArgs(argv)
  const fetchImpl = options.fetchImpl ?? fetch
  const openBrowser =
    options.openBrowser ??
    (async (url: string) => {
      await open(url)
    })
  const rootDir = options.rootDir ?? process.cwd()
  const cwdMode = options.cwdMode ?? false

  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
  })

  let interrupted = false
  const onSigint = () => {
    interrupted = true
    rl.close()
  }
  process.once('SIGINT', onSigint)

  const ask = async (message: string, initial = ''): Promise<string> => {
    if (interrupted) throw new UserCancelledError()
    const suffix = initial ? ` [${initial}]` : ''
    const answer = await rl.question(`${message}${suffix} `)
    if (interrupted) throw new UserCancelledError()
    const trimmed = answer.trim()
    if (!trimmed) return initial
    return trimmed
  }

  const retryOrSkip = async (url: string): Promise<'retry' | 'skip'> => {
    const value = await ask(
      `Could not reach server at ${url}. Check your connection. Retry or skip? (r/S)`,
      's',
    )
    return value.toLowerCase().startsWith('r') ? 'retry' : 'skip'
  }

  let createdProjectDir: string | null = null

  try {
    // Step 1: project setup.
    let projectName = parsed.projectName
    let projectDir = rootDir
    if (!cwdMode) {
      if (!projectName && !parsed.skip.has('project')) {
        projectName = await ask('Project name:', 'my-docs')
      }
      projectName = projectName || 'my-docs'
      projectDir = resolve(rootDir, projectName)
      if (existsSync(projectDir)) {
        throw new Error(`Directory "${projectName}" already exists.`)
      }
      mkdirSync(projectDir, { recursive: true })
      createdProjectDir = projectDir
    } else {
      projectName = basename(rootDir)
      projectDir = rootDir
    }

    mkdirSync(join(projectDir, 'docs'), { recursive: true })
    mkdirSync(join(projectDir, '.collabmd'), { recursive: true })

    const configPath = join(projectDir, 'collabmd.json')
    const config = loadConfig(configPath)
    if (!config.name || typeof config.name !== 'string') {
      config.name = projectName
    }

    if (!existsSync(join(projectDir, 'COLLABMD.md'))) {
      writeFileSync(
        join(projectDir, 'COLLABMD.md'),
        `# ${projectName}\n\nThis project uses CollabMD for collaborative markdown editing.\n\n## Comments\n\nCollabMD supports inline comments that sync between the web editor and local files.\n\nComments are stored in \`.collabmd/comments/<filepath>.comments.json\` sidecar files.\nEach file contains a JSON array of comments with line numbers, author, and text.\n\nTo add a comment as an agent or local user, edit the appropriate .comments.json file.\nNew comments will sync to the web editor automatically.\n\nTo reply to a comment, add an entry to the comment's "thread" array.\nTo resolve a comment, set "resolved": true.\n`,
      )
    }
    if (!existsSync(join(projectDir, 'docs', 'welcome.md'))) {
      writeFileSync(
        join(projectDir, 'docs', 'welcome.md'),
        '# Welcome\n\nThis is your first CollabMD document.\n',
      )
    }
    if (!existsSync(join(projectDir, '.gitignore'))) {
      writeFileSync(join(projectDir, '.gitignore'), '.collabmd/\nnode_modules/\n')
    }
    saveConfig(configPath, config)

    // Step 2: server selection.
    let serverUrl: string | null = options.defaultServerUrl ?? null
    if (!parsed.skip.has('server') && !serverUrl) {
      const selected = await ask(
        'Where will this project sync? 1) local 2) collabmd.dev 3) self-hosted',
        '1',
      )
      if (selected === '2') {
        serverUrl = 'https://collabmd.dev'
      } else if (selected === '3') {
        serverUrl = await ask('Server URL:', 'http://localhost:3000')
      } else {
        serverUrl = null
      }
    }

    if (serverUrl) config.server = serverUrl
    else delete config.server
    saveConfig(configPath, config)

    // Step 3: authenticate.
    let credential: Credential | null = null
    if (!serverUrl) {
      console.log('Local mode - no auth needed')
    } else {
      credential = getCredential(serverUrl)
      if (!credential && !parsed.skip.has('auth')) {
        try {
          const state = randomBytes(16).toString('hex')
          const { port, result } = await startLoginServer(state)
          const callbackUrl = `${serverUrl}/api/auth/cli-callback?port=${port}&state=${state}`

          console.log('Opening browser to sign in...')
          await openBrowser(callbackUrl)

          const loginResult = await Promise.race([
            result,
            new Promise<never>((_, reject) => {
              setTimeout(() => reject(new Error('login-timeout')), 60_000)
            }),
          ])

          credential = {
            sessionToken: loginResult.token,
            userId: loginResult.userId,
            email: loginResult.email,
            name: loginResult.name,
            expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
          }
          saveCredential(serverUrl, credential)
        } catch (error) {
          if ((error as Error).message === 'login-timeout') {
            console.error('Authentication timed out after 60 seconds; skipping auth.')
          } else {
            console.error('Authentication failed; skipping auth.')
          }
        }
      }

      if (credential) {
        console.log('\x1b[32m✓\x1b[0m Authenticated')
      }
    }

    // Step 4: workspace.
    let orgId = options.defaultOrgId ?? (typeof config.orgId === 'string' ? config.orgId : '')
    if (serverUrl && credential && !parsed.skip.has('workspace')) {
      while (true) {
        try {
          const listRes = await fetchImpl(`${serverUrl}/api/auth/organization/list`, {
            headers: { Authorization: `Bearer ${credential.sessionToken}` },
          })
          if (!listRes.ok) {
            throw new Error(`list-failed-${listRes.status}`)
          }
          const listPayload = await listRes.json()
          const orgs = extractOrganizations(listPayload)
          const defaultWorkspaceName = `${credential.name || 'My'}'s Workspace`

          if (orgs.length > 0) {
            console.log('Workspaces:')
            orgs.forEach((org, index) => {
              console.log(`  ${index + 1}) ${org.name}`)
            })
            const pick = await ask('Choose workspace number or type "new"', '1')
            if (pick.toLowerCase() === 'new') {
              const nextName = await ask('New workspace name:', defaultWorkspaceName)
              const createRes = await fetchImpl(`${serverUrl}/api/auth/organization/create`, {
                method: 'POST',
                headers: {
                  Authorization: `Bearer ${credential.sessionToken}`,
                  'Content-Type': 'application/json',
                },
                body: JSON.stringify({ name: nextName }),
              })
              if (!createRes.ok) throw new Error(`create-failed-${createRes.status}`)
              const created = (await createRes.json()) as {
                id?: string
                organization?: { id?: string }
              }
              orgId = created.id ?? created.organization?.id ?? ''
            } else {
              const index = Number.parseInt(pick, 10) - 1
              if (orgs[index]) orgId = orgs[index].id
              else orgId = orgs[0].id
            }
          } else {
            const nextName = await ask('Workspace name:', defaultWorkspaceName)
            const createRes = await fetchImpl(`${serverUrl}/api/auth/organization/create`, {
              method: 'POST',
              headers: {
                Authorization: `Bearer ${credential.sessionToken}`,
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({ name: nextName }),
            })
            if (!createRes.ok) throw new Error(`create-failed-${createRes.status}`)
            const created = (await createRes.json()) as {
              id?: string
              organization?: { id?: string }
            }
            orgId = created.id ?? created.organization?.id ?? ''
          }
          break
        } catch {
          const action = await retryOrSkip(serverUrl)
          if (action === 'skip') break
        }
      }
    }

    if (orgId) config.orgId = orgId
    saveConfig(configPath, config)

    // Step 5: invite teammates.
    if (serverUrl && credential && orgId && !parsed.skip.has('invite')) {
      const inviteInput = await ask(
        'Invite teammates (comma-separated emails, or press Enter to skip):',
        '',
      )
      const emails = splitEmails(inviteInput)
      for (const email of emails) {
        let shouldContinue = true
        while (shouldContinue) {
          try {
            const inviteRes = await fetchImpl(`${serverUrl}/api/auth/organization/invite-member`, {
              method: 'POST',
              headers: {
                Authorization: `Bearer ${credential.sessionToken}`,
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({ email, role: 'member', organizationId: orgId }),
            })
            if (!inviteRes.ok) throw new Error(`invite-failed-${inviteRes.status}`)
            console.log(`Invited ${email}`)
            shouldContinue = false
          } catch {
            const action = await retryOrSkip(serverUrl)
            if (action === 'skip') {
              console.log(`Skipped invite for ${email}`)
              shouldContinue = false
            }
          }
        }
      }
    }

    // Step 6: link and scan.
    saveConfig(configPath, config)
    const markdownFiles = parsed.skip.has('scan') ? [] : await scanMarkdownFiles(projectDir)
    console.log(
      `Found ${markdownFiles.length} markdown files. These will sync when you run collabmd dev.`,
    )
    console.log('')
    console.log('Summary:')
    console.log(`  Workspace URL: ${serverUrl ? serverUrl : 'local mode'}`)
    console.log(`  Linked folder: ${projectDir}`)
    console.log(`  Markdown files: ${markdownFiles.length}`)
    console.log(
      `  Next: ${cwdMode ? 'collabmd dev' : `cd ${relative(rootDir, projectDir) || '.'} && collabmd dev`}`,
    )

    // Step 7: background daemon prompt.
    if (!parsed.skip.has('background')) {
      const background = await ask('Keep syncing in the background? (Y/n)', 'y')
      if (background.toLowerCase().startsWith('n')) {
        console.log('Run collabmd dev to start syncing manually')
      } else {
        console.log('Install background sync service with: collabmd service install')
      }
    }
  } catch (error) {
    if (error instanceof UserCancelledError) {
      console.log('\nCancelled.')
      return
    }
    throw error
  } finally {
    rl.close()
    process.off('SIGINT', onSigint)
    if (interrupted && createdProjectDir) {
      // Files written so far are still valid; leave the directory in place.
    }
  }
}
