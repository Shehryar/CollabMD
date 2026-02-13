import { OpenFgaClient, type WriteAuthorizationModelRequest } from '@openfga/sdk'
import { defaultConfig } from '../config.js'
import model from './model.json'

let fgaClient: OpenFgaClient | null = null
let resolvedStoreId: string | null = null

export async function getFgaClient(): Promise<OpenFgaClient> {
  if (fgaClient) return fgaClient

  const apiUrl = process.env.OPENFGA_URL ?? defaultConfig.permissions.url

  const tempClient = new OpenFgaClient({ apiUrl })
  const { stores } = await tempClient.listStores()
  const existing = stores?.find((s) => s.name === 'collabmd')

  if (existing) {
    resolvedStoreId = existing.id!
  } else {
    const created = await tempClient.createStore({ name: 'collabmd' })
    resolvedStoreId = created.id!
  }

  fgaClient = new OpenFgaClient({ apiUrl, storeId: resolvedStoreId })
  return fgaClient
}

export function resetFgaClient(): void {
  fgaClient = null
  resolvedStoreId = null
}

export async function writeAuthModel(): Promise<string> {
  const client = await getFgaClient()
  const { authorization_model_id } = await client.writeAuthorizationModel(
    model as unknown as WriteAuthorizationModelRequest,
  )
  return authorization_model_id!
}

export async function checkPermission(
  userId: string,
  relation: string,
  objectType: string,
  objectId: string,
): Promise<boolean> {
  const client = await getFgaClient()
  const { allowed } = await client.check({
    user: `user:${userId}`,
    relation,
    object: `${objectType}:${objectId}`,
  })
  return allowed ?? false
}

export async function writeTuple(
  user: string,
  relation: string,
  object: string,
): Promise<void> {
  const client = await getFgaClient()
  await client.write({ writes: [{ user, relation, object }] })
}

export async function deleteTuple(
  user: string,
  relation: string,
  object: string,
): Promise<void> {
  const client = await getFgaClient()
  await client.write({ deletes: [{ user, relation, object }] })
}

export async function readTuples(
  object: string,
): Promise<Array<{ user: string; relation: string; object: string }>> {
  const client = await getFgaClient()
  const { tuples } = await client.read({ object })
  return (tuples ?? []).map((t) => ({
    user: t.key.user,
    relation: t.key.relation,
    object: t.key.object,
  }))
}

export async function readTuplesForEntity(
  entity: string,
): Promise<Array<{ user: string; relation: string; object: string }>> {
  const client = await getFgaClient()
  const [byObject, byUser] = await Promise.all([
    client.read({ object: entity }),
    client.read({ user: entity }),
  ])

  const seen = new Set<string>()
  const tuples = [...(byObject.tuples ?? []), ...(byUser.tuples ?? [])]
  const result: Array<{ user: string; relation: string; object: string }> = []
  for (const t of tuples) {
    const key = `${t.key.user}|${t.key.relation}|${t.key.object}`
    if (seen.has(key)) continue
    seen.add(key)
    result.push({
      user: t.key.user,
      relation: t.key.relation,
      object: t.key.object,
    })
  }
  return result
}

export async function listAccessibleObjects(
  userId: string,
  relation: string,
  objectType: string,
): Promise<string[]> {
  const client = await getFgaClient()
  const { objects } = await client.listObjects({
    user: `user:${userId}`,
    relation,
    type: objectType,
  })
  return objects ?? []
}
