import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs'
import { join } from 'path'

export class DocMapping {
  private mapFile: string
  private map: Record<string, string> = {}

  constructor(workDir: string) {
    const collabmdDir = join(workDir, '.collabmd')
    if (!existsSync(collabmdDir)) mkdirSync(collabmdDir, { recursive: true })
    this.mapFile = join(collabmdDir, 'doc-map.json')
    this.load()
  }

  private load(): void {
    if (!existsSync(this.mapFile)) {
      this.map = {}
      return
    }
    try {
      this.map = JSON.parse(readFileSync(this.mapFile, 'utf-8'))
    } catch {
      this.map = {}
    }
  }

  save(): void {
    writeFileSync(this.mapFile, JSON.stringify(this.map, null, 2) + '\n')
  }

  getDocId(relativePath: string): string | undefined {
    return this.map[relativePath]
  }

  setDocId(relativePath: string, docId: string): void {
    this.map[relativePath] = docId
    this.save()
  }

  removeDoc(relativePath: string): void {
    delete this.map[relativePath]
    this.save()
  }

  getAllMappings(): Record<string, string> {
    return { ...this.map }
  }

  getPathForDocId(docId: string): string | undefined {
    return Object.entries(this.map).find(([, id]) => id === docId)?.[0]
  }
}
