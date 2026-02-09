import { startOpenFGA, stopOpenFGA } from './openfga-dev.js'

const API_URL = 'http://localhost:8081'

async function smokeTest() {
  await startOpenFGA()

  try {
    // 1. Create a store
    console.log('\n--- Creating store ---')
    const storeRes = await fetch(`${API_URL}/stores`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'collabmd-test' }),
    })
    const store = (await storeRes.json()) as { id: string }
    console.log(`Store created: ${store.id}`)

    const storeUrl = `${API_URL}/stores/${store.id}`

    // 2. Write authorization model (simplified CollabMD model)
    console.log('\n--- Writing authorization model ---')
    const modelRes = await fetch(`${storeUrl}/authorization-models`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        schema_version: '1.1',
        type_definitions: [
          {
            type: 'user',
            relations: {},
          },
          {
            type: 'document',
            relations: {
              owner: { this: {} },
              editor: {
                union: {
                  child: [{ this: {} }, { computedUserset: { relation: 'owner' } }],
                },
              },
              viewer: {
                union: {
                  child: [
                    { this: {} },
                    { computedUserset: { relation: 'editor' } },
                  ],
                },
              },
            },
            metadata: {
              relations: {
                owner: { directly_related_user_types: [{ type: 'user' }] },
                editor: { directly_related_user_types: [{ type: 'user' }] },
                viewer: { directly_related_user_types: [{ type: 'user' }] },
              },
            },
          },
        ],
      }),
    })
    const model = (await modelRes.json()) as { authorization_model_id: string }
    console.log(`Model created: ${model.authorization_model_id}`)

    // 3. Write a tuple: alice is owner of doc:readme
    console.log('\n--- Writing tuple: alice owns doc:readme ---')
    const writeRes = await fetch(`${storeUrl}/write`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        writes: {
          tuple_keys: [
            { user: 'user:alice', relation: 'owner', object: 'document:readme' },
          ],
        },
        authorization_model_id: model.authorization_model_id,
      }),
    })
    if (!writeRes.ok) {
      throw new Error(`Write failed: ${await writeRes.text()}`)
    }
    console.log('Tuple written')

    // 4. Check: can alice view doc:readme? (should be true via owner -> editor -> viewer)
    console.log('\n--- Check: can alice view doc:readme? ---')
    const checkRes = await fetch(`${storeUrl}/check`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        tuple_key: { user: 'user:alice', relation: 'viewer', object: 'document:readme' },
        authorization_model_id: model.authorization_model_id,
      }),
    })
    const checkResult = (await checkRes.json()) as { allowed: boolean }
    console.log(`Result: ${checkResult.allowed ? 'ALLOWED' : 'DENIED'}`)

    if (!checkResult.allowed) {
      throw new Error('Smoke test FAILED: alice should be allowed to view as owner')
    }

    // 5. Check: can bob view doc:readme? (should be false)
    console.log('\n--- Check: can bob view doc:readme? ---')
    const checkRes2 = await fetch(`${storeUrl}/check`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        tuple_key: { user: 'user:bob', relation: 'viewer', object: 'document:readme' },
        authorization_model_id: model.authorization_model_id,
      }),
    })
    const checkResult2 = (await checkRes2.json()) as { allowed: boolean }
    console.log(`Result: ${checkResult2.allowed ? 'ALLOWED' : 'DENIED'}`)

    if (checkResult2.allowed) {
      throw new Error('Smoke test FAILED: bob should NOT be allowed to view')
    }

    console.log('\n✅ OpenFGA smoke test PASSED')
  } finally {
    stopOpenFGA()
  }
}

smokeTest().catch((err) => {
  console.error('Smoke test failed:', err)
  stopOpenFGA()
  process.exit(1)
})
