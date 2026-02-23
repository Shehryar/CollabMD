const FGA_URL = 'http://localhost:8082'

let cachedStoreId: string | null = null

export async function getStoreId(): Promise<string> {
  if (cachedStoreId) return cachedStoreId

  const res = await fetch(`${FGA_URL}/stores`)
  const body = (await res.json()) as { stores?: Array<{ id: string; name: string }> }
  const store = body.stores?.find((s) => s.name === 'collabmd')
  if (!store) throw new Error('OpenFGA collabmd store not found')

  cachedStoreId = store.id
  return cachedStoreId
}

export async function writeTuple(
  user: string,
  relation: string,
  object: string,
): Promise<void> {
  const storeId = await getStoreId()
  const res = await fetch(`${FGA_URL}/stores/${storeId}/write`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      writes: { tuple_keys: [{ user, relation, object }] },
    }),
  })

  if (!res.ok) {
    const text = await res.text()
    // Swallow "already exists" errors
    if (text.includes('already exists')) return
    throw new Error(`OpenFGA write failed: ${res.status} ${text}`)
  }
}

export async function grantDocAccess(
  userId: string,
  relation: string,
  docId: string,
): Promise<void> {
  await writeTuple(`user:${userId}`, relation, `document:${docId}`)
}

export async function grantOrgMembership(
  userId: string,
  role: string,
  orgId: string,
): Promise<void> {
  await writeTuple(`user:${userId}`, role, `org:${orgId}`)
}

export async function setDocOrg(orgId: string, docId: string): Promise<void> {
  await writeTuple(`org:${orgId}`, 'org', `document:${docId}`)
}
