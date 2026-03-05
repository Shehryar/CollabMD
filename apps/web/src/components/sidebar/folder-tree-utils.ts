import type { Folder } from './sidebar-context'

/** Sort items by position first, then alphabetically by name/title as fallback. */
export function sortByPosition<T extends { position?: number }>(
  items: T[],
  getName: (item: T) => string,
): T[] {
  return [...items].sort((a, b) => {
    const posA = a.position ?? 0
    const posB = b.position ?? 0
    if (posA !== posB) return posA - posB
    return getName(a).localeCompare(getName(b))
  })
}

/**
 * Detect circular references: returns true if `targetParentId` is the folder
 * itself or one of its descendants.
 */
export function wouldCreateCircle(
  folderId: string,
  targetParentId: string | null,
  folders: Folder[],
): boolean {
  if (targetParentId === null) return false
  if (targetParentId === folderId) return true
  const byId = new Map(folders.map((f) => [f.id, f]))
  let cursor: string | null = targetParentId
  while (cursor) {
    if (cursor === folderId) return true
    const folder = byId.get(cursor)
    cursor = folder?.parentId ?? null
  }
  return false
}
