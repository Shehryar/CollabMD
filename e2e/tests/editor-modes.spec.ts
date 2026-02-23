import { test, expect, grantDocAccess, setDocOrg } from '../fixtures/auth'
import { createTestDocument } from '../helpers/db'

test.describe('Editor Modes', () => {
  test('mode switching between editing, suggesting, and viewing', async ({
    authenticatedPage: page,
    testUser,
    testOrg,
  }) => {
    const doc = createTestDocument({
      orgId: testOrg.id,
      ownerId: testUser.id,
      title: 'Mode Test Doc',
    })
    await grantDocAccess(testUser.id, 'owner', doc.id)
    await setDocOrg(testOrg.id, doc.id)

    await page.goto(`/doc/${doc.id}`)

    // Wait for toolbar to appear (doc fully loaded)
    await expect(page.getByRole('toolbar', { name: /formatting/i })).toBeVisible({
      timeout: 30_000,
    })

    const modeGroup = page.getByRole('radiogroup', { name: /editor mode/i })
    await expect(modeGroup).toBeVisible()

    // Editing should be the default active mode for an owner
    const editingRadio = modeGroup.getByRole('radio', { name: /editing/i })
    await expect(editingRadio).toHaveAttribute('aria-checked', 'true')

    // Switch to Suggesting
    const suggestingRadio = modeGroup.getByRole('radio', { name: /suggesting/i })
    await suggestingRadio.click()
    await expect(suggestingRadio).toHaveAttribute('aria-checked', 'true')
    await expect(editingRadio).toHaveAttribute('aria-checked', 'false')

    // Switch to Viewing
    const viewingRadio = modeGroup.getByRole('radio', { name: /viewing/i })
    await viewingRadio.click()
    await expect(viewingRadio).toHaveAttribute('aria-checked', 'true')
    await expect(suggestingRadio).toHaveAttribute('aria-checked', 'false')
  })

  test('viewing mode makes editor read-only', async ({
    authenticatedPage: page,
    testUser,
    testOrg,
  }) => {
    const doc = createTestDocument({
      orgId: testOrg.id,
      ownerId: testUser.id,
      title: 'ReadOnly Test',
    })
    await grantDocAccess(testUser.id, 'owner', doc.id)
    await setDocOrg(testOrg.id, doc.id)

    await page.goto(`/doc/${doc.id}`)

    await expect(page.getByRole('toolbar', { name: /formatting/i })).toBeVisible({
      timeout: 30_000,
    })

    // Switch to Viewing mode
    const modeGroup = page.getByRole('radiogroup', { name: /editor mode/i })
    await modeGroup.getByRole('radio', { name: /viewing/i }).click()

    // cm-content should become non-editable
    await expect(page.locator('.cm-content')).toHaveAttribute('contenteditable', 'false')
  })

  test('viewer sees no toolbar and view-only banner', async ({
    createAuthenticatedContext,
    testUser: owner,
    testOrg,
  }) => {
    const doc = createTestDocument({
      orgId: testOrg.id,
      ownerId: owner.id,
      title: 'Viewer Mode Doc',
    })
    await grantDocAccess(owner.id, 'owner', doc.id)
    await setDocOrg(testOrg.id, doc.id)

    // Create a viewer
    const { page: viewerPage, user: viewer } = await createAuthenticatedContext({
      name: 'View Only User',
    })
    await grantDocAccess(viewer.id, 'viewer', doc.id)

    await viewerPage.goto(`/doc/${doc.id}`)

    // Should see view-only banner
    await expect(viewerPage.getByText('view-only access')).toBeVisible({ timeout: 30_000 })

    // Should NOT have the formatting toolbar
    await expect(viewerPage.getByRole('toolbar', { name: /formatting/i })).not.toBeVisible()

    // Editor should be read-only
    await expect(viewerPage.locator('.cm-content')).toHaveAttribute('contenteditable', 'false')
  })
})
