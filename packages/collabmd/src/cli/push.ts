import simpleGit from 'simple-git'

export interface PushCommandOptions {
  remote?: string
  branch?: string
  workDir?: string
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

export async function pushCommand(options: PushCommandOptions = {}): Promise<void> {
  const workDir = options.workDir ?? process.cwd()
  const remote = options.remote ?? 'origin'
  const git = simpleGit(workDir)

  try {
    const hasRemote = await ensureRemoteConfigured(remote, workDir, git)
    if (!hasRemote) return

    const branch = options.branch ?? (await git.branch()).current
    if (!branch) {
      console.error('Could not determine the current branch. Pass --branch <name>.')
      return
    }

    await git.push(remote, branch)
    console.log(`Pushed ${branch} to ${remote}.`)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.error(`Push failed: ${message}`)
    console.error('Push was rejected. Try running `collabmd pull` first, then push again.')
  }
}
