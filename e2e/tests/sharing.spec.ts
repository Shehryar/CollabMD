import { test, expect, grantDocAccess, setDocOrg } from '../fixtures/auth'
import { createTestDocument } from '../helpers/db'

test.describe('Sharing & Permissions', () => {
  test('share dialog opens and can share as editor', async ({
    authenticatedPage: page,
    createAuthenticatedContext,
    testUser,
    testOrg,
  }) => {
    // Create a target user who we will share with
    const { user: recipient } = await createAuthenticatedContext({
      name: 'Recipient',
    })

    const doc = createTestDocument({
      orgId: testOrg.id,
      ownerId: testUser.id,
      title: 'Shareable Doc',
    })
    await grantDocAccess(testUser.id, 'owner', doc.id)
    await setDocOrg(testOrg.id, doc.id)

    await page.goto(`/doc/${doc.id}`)

    // Wait for the doc to load (Share button appears in header)
    const headerShareBtn = page.locator('header button').filter({ hasText: /^Share$/ })
    await expect(headerShareBtn).toBeVisible({ timeout: 30_000 })

    // Click Share button in header
    await headerShareBtn.click()

    // Share dialog should appear
    const dialog = page.getByRole('dialog')
    await expect(dialog).toBeVisible()

    // Enter email
    const emailInput = dialog.getByPlaceholder('Email address')
    await emailInput.fill(recipient.email)

    // Select Editor role (first select in the dialog is the role dropdown)
    await dialog.locator('select').first().selectOption('editor')

    // Click Share button in dialog
    await dialog.getByRole('button', { name: 'Share' }).click()

    // Should show success message
    await expect(dialog.getByText(`Shared with ${recipient.email}`)).toBeVisible({
      timeout: 10_000,
    })
  })

  test('viewer sees read-only banner and no formatting toolbar', async ({
    createAuthenticatedContext,
    testUser: owner,
    testOrg,
  }) => {
    const doc = createTestDocument({
      orgId: testOrg.id,
      ownerId: owner.id,
      title: 'Viewer Doc',
    })
    await grantDocAccess(owner.id, 'owner', doc.id)
    await setDocOrg(testOrg.id, doc.id)

    // Create a viewer
    const { page: viewerPage, user: viewer } = await createAuthenticatedContext({
      name: 'Viewer User',
    })
    await grantDocAccess(viewer.id, 'viewer', doc.id)

    await viewerPage.goto(`/doc/${doc.id}`)

    // Should see view-only banner (wait for doc to load)
    await expect(viewerPage.getByText('view-only access')).toBeVisible({ timeout: 30_000 })

    // Should NOT see formatting toolbar
    await expect(viewerPage.getByRole('toolbar', { name: /formatting/i })).not.toBeVisible()
  })

  test('commenter gets suggesting and viewing modes only', async ({
    createAuthenticatedContext,
    testUser: owner,
    testOrg,
  }) => {
    const doc = createTestDocument({
      orgId: testOrg.id,
      ownerId: owner.id,
      title: 'Commenter Doc',
    })
    await grantDocAccess(owner.id, 'owner', doc.id)
    await setDocOrg(testOrg.id, doc.id)

    // Create a commenter
    const { page: commenterPage, user: commenter } = await createAuthenticatedContext({
      name: 'Commenter User',
    })
    await grantDocAccess(commenter.id, 'commenter', doc.id)

    await commenterPage.goto(`/doc/${doc.id}`)

    // Wait for the toolbar to appear
    await expect(commenterPage.getByRole('toolbar', { name: /formatting/i })).toBeVisible({
      timeout: 30_000,
    })

    // Mode radiogroup should exist
    const modeGroup = commenterPage.getByRole('radiogroup', { name: /editor mode/i })
    await expect(modeGroup).toBeVisible()

    // Should have Suggesting and Viewing but NOT Editing
    await expect(modeGroup.getByRole('radio', { name: /suggesting/i })).toBeVisible()
    await expect(modeGroup.getByRole('radio', { name: /viewing/i })).toBeVisible()
    await expect(modeGroup.getByRole('radio', { name: /editing/i })).not.toBeVisible()
  })
})
