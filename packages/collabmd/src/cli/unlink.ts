import { removeProject } from '../daemon/registry.js'

export function unlinkCommand(): void {
  removeProject(process.cwd())
  console.log('Unlinked current folder from global daemon registry')
}

