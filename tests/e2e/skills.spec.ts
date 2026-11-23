import { expect, test } from '@playwright/test'

/** Plugins → Skills against the mock API: upload, review, install, then the skill is offered in the `/` menu. */
const MOCK = `http://127.0.0.1:${process.env.E2E_MOCK_PORT ?? 4019}`

test.beforeEach(async ({ request }) => {
  await request.post(`${MOCK}/__mock/reset`)
})

test('upload a skill, review and install it, then find it in the / menu under Library', async ({ page }) => {
  await page.goto('/login')
  await page.getByLabel('API key').fill('agk_test')
  await page.getByRole('button', { name: 'Sign in' }).click()
  await page.waitForURL('/')

  await page.goto('/plugins?tab=skills')
  await expect(page.getByText('review', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Library' }).click()
  await page.locator('input[type="file"]').setInputFiles({ name: 'haiku.zip', mimeType: 'application/zip', buffer: Buffer.from('PK') })

  const review = page.getByRole('dialog', { name: 'Review haiku' })
  await expect(review.getByText(/includes scripts that run in your agent's sandbox/)).toBeVisible()
  await expect(review.getByText('scripts/run.sh')).toBeVisible()
  await review.getByRole('button', { name: 'Install' }).click()
  await expect(review).toBeHidden()
  await expect(page.getByText('haiku', { exact: true })).toBeVisible()

  await page.goto('/')
  await expect(page.getByRole('combobox', { name: 'Model' })).toContainText('mock-model')
  const composer = page.getByRole('combobox', { name: 'Message input' })
  await composer.click()
  await page.keyboard.type('/')
  const library = page.getByRole('group', { name: 'Library' })
  await expect(library.getByRole('option', { name: /^\/haiku/ })).toBeVisible()
  await expect(page.getByRole('group', { name: 'Built-in' }).getByRole('option', { name: /^\/review/ })).toBeVisible()
})
