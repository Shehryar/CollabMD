import { test, expect, grantDocAccess, setDocOrg } from '../fixtures/auth'
import { createTestDocument } from '../helpers/db'

test.describe('Document Lifecycle', () => {
  test('create a new document', async ({ authenticatedPage: page }) => {
    // Warm up auth route (Next.js dev compiles on-demand; first call may be slow)
    await page.request.get('/api/auth/get-session')

    await page.goto('/')

    // Wait for the page to fully load (session resolved, heading visible)
    await expect(page.getByRole('heading', { name: 'All documents' })).toBeVisible({
      timeout: 30_000,
    })

    // Click the "+ new" button in sidebar (exact text to avoid matching "New folder")
    await page.getByRole('button', { name: '+ new' }).click()

    // Should redirect to /doc/... (may take time for Next.js to compile the doc page on first visit)
    await expect(page).toHaveURL(/\/doc\//, { timeout: 30_000 })

    // Editor should be visible
    await expect(page.locator('.cm-editor')).toBeVisible({ timeout: 15_000 })
  })

  test('edit document title', async ({ authenticatedPage: page, testUser, testOrg }) => {
    const doc = createTestDocument({
      orgId: testOrg.id,
      ownerId: testUser.id,
      title: 'Original Title',
    })
    await grantDocAccess(testUser.id, 'owner', doc.id)
    await setDocOrg(testOrg.id, doc.id)

    await page.goto(`/doc/${doc.id}`)

    // Wait for doc to load (title button appears once loading finishes)
    await expect(page.getByRole('button', { name: 'Original Title' })).toBeVisible({
      timeout: 30_000,
    })

    // Click the title button to enter edit mode
    await page.getByRole('button', { name: 'Original Title' }).click()

    // Fill the input with new title
    const titleInput = page.locator('header input')
    await titleInput.fill('Updated Title')
    await titleInput.press('Enter')

    // Title should update in the header
    await expect(page.getByRole('button', { name: 'Updated Title' })).toBeVisible({
      timeout: 10_000,
    })
  })

  test('type in editor', async ({ authenticatedPage: page, testUser, testOrg }) => {
    const doc = createTestDocument({ orgId: testOrg.id, ownerId: testUser.id })
    await grantDocAccess(testUser.id, 'owner', doc.id)
    await setDocOrg(testOrg.id, doc.id)

    await page.goto(`/doc/${doc.id}`)

    // Wait for editor to be ready (don't require sync — typing works locally)
    await expect(page.locator('.cm-editor')).toBeVisible({ timeout: 30_000 })

    // Click the editor content area and type
    const editor = page.locator('.cm-content')
    await editor.click()
    await editor.pressSequentially('Hello E2E Test', { delay: 30 })

    // Text should appear
    await expect(editor).toContainText('Hello E2E Test')
  })

  test('trash and restore a document', async ({ authenticatedPage: page, testUser, testOrg }) => {
    const doc = createTestDocument({
      orgId: testOrg.id,
      ownerId: testUser.id,
      title: 'Doc To Trash',
    })
    await grantDocAccess(testUser.id, 'owner', doc.id)
    await setDocOrg(testOrg.id, doc.id)

    await page.goto('/')

    // Scope assertions to main content (title also appears in sidebar)
    const main = page.locator('main')

    // Wait for page to load and show the document
    await expect(page.getByRole('heading', { name: 'All documents' })).toBeVisible({
      timeout: 30_000,
    })
    await expect(main.getByText('Doc To Trash')).toBeVisible({ timeout: 10_000 })

    // Hover over the doc row (the <li> containing the title) to reveal actions
    const docRow = main.locator('li').filter({ hasText: 'Doc To Trash' })
    await docRow.hover()

    // Click Delete (visible on hover via group-hover)
    await docRow.getByText('Delete', { exact: true }).click()

    // Doc should disappear from the main list
    await expect(main.getByText('Doc To Trash')).not.toBeVisible({ timeout: 10_000 })

    // Navigate to Trash
    await page.goto('/trash')

    // Wait for trash page to load
    await expect(page.getByRole('heading', { name: 'Trash' })).toBeVisible({ timeout: 30_000 })

    // Doc should be in trash
    await expect(main.getByText('Doc To Trash')).toBeVisible({ timeout: 10_000 })

    // Click Restore (scoped to the doc's row)
    const trashRow = main.locator('li').filter({ hasText: 'Doc To Trash' })
    await trashRow.getByText('Restore', { exact: true }).click()

    // Doc should disappear from trash
    await expect(main.getByText('Doc To Trash')).not.toBeVisible({ timeout: 10_000 })

    // Go back to home, doc should be there again
    await page.goto('/')
    await expect(page.getByRole('heading', { name: 'All documents' })).toBeVisible({
      timeout: 30_000,
    })
    await expect(main.getByText('Doc To Trash')).toBeVisible({ timeout: 10_000 })
  })

  test('trash and permanently delete a document', async ({
    authenticatedPage: page,
    testUser,
    testOrg,
  }) => {
    const doc = createTestDocument({
      orgId: testOrg.id,
      ownerId: testUser.id,
      title: 'Doc To Destroy',
    })
    await grantDocAccess(testUser.id, 'owner', doc.id)
    await setDocOrg(testOrg.id, doc.id)

    await page.goto('/')

    // Scope assertions to main content (title also appears in sidebar)
    const main = page.locator('main')

    // Wait for page to load
    await expect(page.getByRole('heading', { name: 'All documents' })).toBeVisible({
      timeout: 30_000,
    })
    await expect(main.getByText('Doc To Destroy')).toBeVisible({ timeout: 10_000 })

    // Hover and delete
    const docRow = main.locator('li').filter({ hasText: 'Doc To Destroy' })
    await docRow.hover()
    await docRow.getByText('Delete', { exact: true }).click()
    await expect(main.getByText('Doc To Destroy')).not.toBeVisible({ timeout: 10_000 })

    // Navigate to Trash
    await page.goto('/trash')
    await expect(page.getByRole('heading', { name: 'Trash' })).toBeVisible({ timeout: 30_000 })
    await expect(main.getByText('Doc To Destroy')).toBeVisible({ timeout: 10_000 })

    // Accept the upcoming confirmation dialog
    page.on('dialog', (dialog) => dialog.accept())

    // Click "Delete permanently"
    const trashRow = main.locator('li').filter({ hasText: 'Doc To Destroy' })
    await trashRow.getByText('Delete permanently').click()

    // Doc should be gone from trash
    await expect(main.getByText('Doc To Destroy')).not.toBeVisible({ timeout: 10_000 })

    // Should not appear in main list either
    await page.goto('/')
    await expect(page.getByRole('heading', { name: 'All documents' })).toBeVisible({
      timeout: 30_000,
    })
    await expect(main.getByText('Doc To Destroy')).not.toBeVisible()
  })
})
