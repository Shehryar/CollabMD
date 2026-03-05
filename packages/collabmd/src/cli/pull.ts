import { mkdirSync, writeFileSync } from 'fs'
import { join } from 'path'
import simpleGit from 'simple-git'

export interface PullCommandOptions {
  remote?: string
  branch?: string
  workDir?: string
}

function unique(paths: string[]): string[] {
  return Array.from(new Set(paths)).sort()
}

function listConflictFiles(conflicts: unknown): string[] {
  if (!Array.isArray(conflicts)) return []

  return unique(
    conflicts.flatMap((entry) => {
      if (typeof entry === 'string') return [entry]
      if (entry && typeof entry === 'object' && 'file' in entry && typeof entry.file === 'string') {
        return [entry.file]
      }
      return []
    }),
  )
}

function writeConflictsFile(workDir: string, conflicts: string[]): void {
  const collabDir = join(workDir, '.collabmd')
  const path = join(collabDir, 'conflicts.json')
  mkdirSync(collabDir, { recursive: true })
  writeFileSync(
    path,
    JSON.stringify(
      {
        conflicts,
        mergedAt: new Date().toISOString(),
      },
      null,
      2,
    ) + '\n',
  )
}

function printConflictInstructions(conflicts: string[]): void {
  console.log('Merge conflicts detected:')
  for (const file of conflicts) {
    console.log(`- ${file}`)
  }
  console.log('Resolve conflicts in your editor, then run collabmd push')
}

async function ensureRemoteConfigured(
  remote: string,
  workDir: string,
  git: ReturnType<typeof simpleGit>,
): Promise<boolean> {
  const remotes = await git.getRemotes(true)

  if (remotes.length === 0) {
    console.error(
      `No git remotes are configured for ${workDir}. Add one with \`git remote add origin <url>\`.`,
    )
    return false
  }

  if (!remotes.some((entry) => entry.name === remote)) {
    console.error(`Remote "${remote}" is not configured for ${workDir}.`)
    return false
  }

  return true
}

async function listConflictsFromRepo(git: ReturnType<typeof simpleGit>): Promise<string[]> {
  const status = await git.status()
  return unique(status.conflicted)
}

export async function pullCommand(options: PullCommandOptions = {}): Promise<void> {
  const workDir = options.workDir ?? process.cwd()
  const remote = options.remote ?? 'origin'
  const git = simpleGit(workDir)

  try {
    const hasRemote = await ensureRemoteConfigured(remote, workDir, git)
    if (!hasRemote) return

    const statusBefore = await git.status()
    if (statusBefore.files.length > 0) {
      console.error(
        'Pull aborted: repository has uncommitted changes. Commit or stash your changes first.',
      )
      return
    }

    const branch = options.branch ?? (await git.branch()).current
    if (!branch) {
      console.error('Could not determine the current branch. Pass --branch <name>.')
      return
    }

    await git.fetch(remote)

    try {
      const mergeResult = await git.merge([`${remote}/${branch}`])
      const conflictsFromMerge = listConflictFiles(
        (mergeResult as { conflicts?: unknown }).conflicts,
      )
      const conflicts =
        conflictsFromMerge.length > 0 ? conflictsFromMerge : await listConflictsFromRepo(git)

      if (conflicts.length > 0) {
        writeConflictsFile(workDir, conflicts)
        printConflictInstructions(conflicts)
        return
      }

      console.log(`Pulled ${branch} from ${remote}.`)
      const changedFiles = Array.isArray((mergeResult as { files?: unknown }).files)
        ? (mergeResult as { files: string[] }).files
        : []

      if (changedFiles.length === 0) {
        console.log('No files changed.')
        return
      }

      console.log('Changed files:')
      for (const file of changedFiles) {
        console.log(`- ${file}`)
      }
    } catch (error) {
      const conflictsFromError = listConflictFiles(
        (error as { git?: { conflicts?: unknown } })?.git?.conflicts,
      )
      const conflicts =
        conflictsFromError.length > 0 ? conflictsFromError : await listConflictsFromRepo(git)

      if (conflicts.length > 0) {
        writeConflictsFile(workDir, conflicts)
        printConflictInstructions(conflicts)
        return
      }

      const message = error instanceof Error ? error.message : String(error)
      console.error(`Pull failed: ${message}`)
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.error(`Pull failed: ${message}`)
  }
}
