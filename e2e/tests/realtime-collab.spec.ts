import { test, expect, grantDocAccess, setDocOrg } from '../fixtures/auth'
import { createTestDocument } from '../helpers/db'

test.describe('Real-Time Collaboration', () => {
  test("two users see each other's edits", async ({
    authenticatedPage: alicePage,
    createAuthenticatedContext,
    testUser: alice,
    testOrg,
  }) => {
    // Create a shared document
    const doc = createTestDocument({
      orgId: testOrg.id,
      ownerId: alice.id,
      title: 'Collab Doc',
    })
    await grantDocAccess(alice.id, 'owner', doc.id)
    await setDocOrg(testOrg.id, doc.id)

    // Create Bob
    const { page: bobPage, user: bob } = await createAuthenticatedContext({
      name: 'Bob',
    })
    await grantDocAccess(bob.id, 'editor', doc.id)

    // Both open the document
    await alicePage.goto(`/doc/${doc.id}`)
    await bobPage.goto(`/doc/${doc.id}`)

    // Wait for both to be synced
    await expect(alicePage.getByText('synced')).toBeVisible({ timeout: 30_000 })
    await expect(bobPage.getByText('synced')).toBeVisible({ timeout: 30_000 })

    // Alice types
    const aliceEditor = alicePage.locator('.cm-content')
    await aliceEditor.click()
    await aliceEditor.pressSequentially('Hello from Alice', { delay: 30 })

    // Bob should see Alice's text
    await expect(bobPage.locator('.cm-content')).toContainText('Hello from Alice', {
      timeout: 10_000,
    })

    // Bob types
    const bobEditor = bobPage.locator('.cm-content')
    await bobEditor.click()
    await bobEditor.press('End')
    await bobEditor.pressSequentially('\nHello from Bob', { delay: 30 })

    // Alice should see Bob's text
    await expect(alicePage.locator('.cm-content')).toContainText('Hello from Bob', {
      timeout: 10_000,
    })
  })

  test('simultaneous typing converges', async ({
    authenticatedPage: alicePage,
    createAuthenticatedContext,
    testUser: alice,
    testOrg,
  }) => {
    const doc = createTestDocument({
      orgId: testOrg.id,
      ownerId: alice.id,
      title: 'Convergence Doc',
    })
    await grantDocAccess(alice.id, 'owner', doc.id)
    await setDocOrg(testOrg.id, doc.id)

    const { page: bobPage, user: bob } = await createAuthenticatedContext({
      name: 'Bob',
    })
    await grantDocAccess(bob.id, 'editor', doc.id)

    await alicePage.goto(`/doc/${doc.id}`)
    await bobPage.goto(`/doc/${doc.id}`)

    await expect(alicePage.getByText('synced')).toBeVisible({ timeout: 30_000 })
    await expect(bobPage.getByText('synced')).toBeVisible({ timeout: 30_000 })

    // Both type simultaneously
    const aliceEditor = alicePage.locator('.cm-content')
    const bobEditor = bobPage.locator('.cm-content')

    await aliceEditor.click()
    await bobEditor.click()

    // Type at the same time (interleaved)
    await Promise.all([
      aliceEditor.pressSequentially('AAA', { delay: 50 }),
      bobEditor.pressSequentially('BBB', { delay: 50 }),
    ])

    // Wait for sync to settle
    await alicePage.waitForTimeout(3_000)

    // Extract document text from .cm-line elements (excludes awareness cursor decorations)
    const getText = (page: typeof alicePage) =>
      page.evaluate(() =>
        Array.from(document.querySelectorAll('.cm-line'))
          .map((line) => {
            // Clone the line and remove awareness cursor widgets before extracting text
            const clone = line.cloneNode(true) as HTMLElement
            clone
              .querySelectorAll('.cm-ySelectionCaret, .cm-ySelectionCaretDot, .cm-widgetBuffer')
              .forEach((el) => el.remove())
            return clone.textContent ?? ''
          })
          .join('\n'),
      )

    const aliceText = await getText(alicePage)
    const bobText = await getText(bobPage)

    // Both should have converged to the same content (CRDT guarantee)
    expect(aliceText).toBe(bobText)
    // Both strings should be present somewhere in the content
    expect(aliceText).toContain('AAA')
    expect(aliceText).toContain('BBB')
  })

  test('presence avatars appear', async ({
    authenticatedPage: alicePage,
    createAuthenticatedContext,
    testUser: alice,
    testOrg,
  }) => {
    const doc = createTestDocument({
      orgId: testOrg.id,
      ownerId: alice.id,
      title: 'Presence Doc',
    })
    await grantDocAccess(alice.id, 'owner', doc.id)
    await setDocOrg(testOrg.id, doc.id)

    const { page: bobPage, user: bob } = await createAuthenticatedContext({
      name: 'Bob',
    })
    await grantDocAccess(bob.id, 'editor', doc.id)

    await alicePage.goto(`/doc/${doc.id}`)
    await bobPage.goto(`/doc/${doc.id}`)

    await expect(alicePage.getByText('synced')).toBeVisible({ timeout: 30_000 })
    await expect(bobPage.getByText('synced')).toBeVisible({ timeout: 30_000 })

    // Alice should see Bob's presence avatar
    await expect(alicePage.locator(`[aria-label="Bob"]`)).toBeVisible({
      timeout: 10_000,
    })

    // Bob should see Alice's presence avatar
    await expect(bobPage.locator(`[aria-label="${alice.name}"]`)).toBeVisible({
      timeout: 10_000,
    })
  })
})
