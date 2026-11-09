import { expect, test, type Page } from '@playwright/test'

/**
 * F1 end to end against the mock Agentry API (see `mock/agentry-mock.ts` for
 * the scripted replies and the `/__mock/*` test hooks) and `next dev` in apikey
 * mode. Started by playwright.config.ts.
 */
const MOCK = `http://127.0.0.1:${process.env.E2E_MOCK_PORT ?? 4019}`
const KEY = 'agk_test'

test.beforeEach(async ({ request }) => {
  await request.post(`${MOCK}/__mock/reset`)
})

async function signIn(page: Page) {
  await page.goto('/login')
  await page.getByLabel('API key').fill(KEY)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await page.waitForURL('/')
}

const composer = (page: Page) => page.getByRole('textbox', { name: 'Message input' })
const assistantMessages = (page: Page) => page.getByTestId('assistant-message')

/** Starts a chat from `/` and waits for its page. */
async function startChat(page: Page, text: string) {
  await expect(page.getByRole('combobox', { name: 'Model' })).toContainText('mock-model')
  await composer(page).click()
  await page.keyboard.type(text)
  await page.keyboard.press('Enter')
  await page.waitForURL(/\/c\/[A-Za-z0-9_-]+$/)
}

async function sendInChat(page: Page, text: string) {
  await composer(page).click()
  await page.keyboard.type(text)
  await page.keyboard.press('Enter')
}

test('apikey sign-in, then a new chat streams the scripted reply', async ({ page }) => {
  const cspViolations: string[] = []
  page.on('console', (m) => {
    if (/Content Security Policy/i.test(m.text())) cspViolations.push(m.text())
  })
  const first = await page.goto('/')
  const headers = first?.headers() ?? {}
  expect(headers['content-security-policy']).toContain("frame-ancestors 'none'")
  expect(headers['content-security-policy']).toContain("img-src 'self' data:")
  expect(headers['x-content-type-options']).toBe('nosniff')
  expect(headers['referrer-policy']).toBe('strict-origin-when-cross-origin')
  await expect(page).toHaveURL(/\/login$/)
  await signIn(page)
  await startChat(page, 'Hello there')

  await expect(page.getByRole('article', { name: /user/i }).getByText('Hello there')).toBeVisible()
  const reply = assistantMessages(page).last()
  await expect(reply).toContainText('Hello from the mock Agentry API.')
  await expect(reply).toContainText('You said: Hello there')
  await expect(reply.locator('pre')).toContainText('const ok = true')
  // The new chat is in the sidebar under its first message.
  await expect(page.getByRole('link', { name: 'Hello there' })).toBeVisible()
  await expect(composer(page)).toBeFocused()
  expect(cspViolations).toEqual([])
})

test('reopening a chat shows the full history once: user, tool and assistant', async ({ page }) => {
  await signIn(page)
  await startChat(page, 'Use a tool please')
  await expect(assistantMessages(page).last()).toContainText('I searched and found 3 results')

  await page.reload()
  await expect(assistantMessages(page).last()).toContainText('I searched and found 3 results')
  await page.waitForTimeout(1000) // let the replay settle
  const users = page.getByRole('article', { name: /user/i })
  await expect(users).toHaveCount(1)
  await expect(users).toHaveText('Use a tool please')
  await expect(page.getByRole('button', { name: /search/ })).toHaveCount(1)
  await expect(assistantMessages(page)).toHaveCount(1)
  await expect(assistantMessages(page)).toHaveText(/^I searched and found 3 results: alpha, beta and gamma\.$/)
})

test('approval card: focus starts on Allow, and Allow resumes the turn', async ({ page }) => {
  await signIn(page)
  await startChat(page, 'Please approve the cleanup')
  const card = page.getByRole('group', { name: 'Approval needed' })
  await expect(card).toContainText('Allow delete_files to remove /tmp/mock?')
  const allow = card.getByRole('button', { name: 'Allow' })
  await expect(allow).toBeFocused()
  await allow.click()
  await expect(assistantMessages(page).last()).toContainText('Done. I deleted the files.')
  await expect(card).toHaveCount(0)
})

test('question card: an option answers the question', async ({ page }) => {
  await signIn(page)
  await startChat(page, 'Ask me a question')
  const card = page.getByRole('group', { name: 'Question' })
  await expect(card.getByRole('radio', { name: 'Red' })).toBeFocused()
  await card.getByRole('radio', { name: 'Blue' }).check()
  await card.getByRole('button', { name: 'Send answer' }).click()
  await expect(assistantMessages(page).last()).toContainText('You picked Blue.')
})

test('Stop interrupts a slow turn mid-stream', async ({ page }) => {
  await signIn(page)
  await startChat(page, 'slow please')
  await expect(assistantMessages(page).last()).toContainText('word3')
  await page.getByRole('button', { name: 'Stop' }).click()
  await expect(page.getByText('Stopped')).toBeVisible()
  const text = await assistantMessages(page).last().textContent()
  await page.waitForTimeout(1500)
  await expect(assistantMessages(page).last()).toHaveText(text ?? '')
  expect(text).not.toContain('word60')
})

test('reconnects after the stream drops and finishes the reply without duplicated text', async ({ page, request }) => {
  await signIn(page)
  await startChat(page, 'slow reply')
  await expect(assistantMessages(page).last()).toContainText('word2 ')

  const resumed = page.waitForRequest((r) => r.url().endsWith('/stream') && r.headers()['last-event-id'] !== '0')
  await request.post(`${MOCK}/__mock/drop`)
  await expect(page.getByRole('status').filter({ hasText: 'Reconnecting…' })).toBeVisible()
  const retry = await resumed
  expect(Number(retry.headers()['last-event-id'])).toBeGreaterThan(0)

  await expect(assistantMessages(page).last()).toContainText('word60', { timeout: 60_000 })
  await expect(page.getByText('Reconnecting…')).toHaveCount(0)
  const text = (await assistantMessages(page).last().textContent()) ?? ''
  const expected = Array.from({ length: 60 }, (_, i) => `word${i + 1}`).join(' ')
  expect(text.replace(/\s+/g, ' ').trim()).toBe(expected)
})

test('reconnect after background shows completed turn', async ({ page, request }) => {
  await signIn(page)
  await startChat(page, 'Please approve the cleanup')
  const card = page.getByRole('group', { name: 'Approval needed' })
  await expect(card).toBeVisible()
  const sessionId = page.url().split('/c/')[1]

  // Hide the page and cut the stream: retries fail and back off.
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' })
    document.dispatchEvent(new Event('visibilitychange'))
  })
  await page.route('**/api/agentry/sessions/*/stream', (route) => route.abort())
  await request.post(`${MOCK}/__mock/drop`)

  // Finish the turn while the page is in the background.
  const session = await (
    await request.get(`${MOCK}/v1/agents/sessions/${sessionId}`, { headers: { authorization: `Bearer ${KEY}` } })
  ).json()
  const approvalId = session.required_actions[0].id
  await request.post(`${MOCK}/v1/agents/sessions/${sessionId}/events`, {
    headers: { authorization: `Bearer ${KEY}` },
    data: { events: [{ type: 'agent.session.input.approval_response', id: approvalId, decision: 'approve' }] },
  })
  await page.waitForTimeout(4_000) // retries are now backing off for several seconds
  await expect(page.getByText('Done. I deleted the files.')).toHaveCount(0)

  // Show the page: it reconnects at once and shows the completed turn.
  await page.unroute('**/api/agentry/sessions/*/stream')
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' })
    document.dispatchEvent(new Event('visibilitychange'))
  })
  await expect(assistantMessages(page).last()).toContainText('Done. I deleted the files.', { timeout: 3_000 })
  await expect(card).toHaveCount(0)
})

test('sign-out returns to /login and ends the session', async ({ page }) => {
  await signIn(page)
  await page.getByRole('button', { name: /API key user/ }).click()
  await page.getByRole('menuitem', { name: 'Sign out' }).click()
  await page.waitForURL(/\/login$/)
  await page.goto('/')
  await expect(page).toHaveURL(/\/login$/)
})

test('no Agentry credential reaches the browser', async ({ page, context }) => {
  const leaks: string[] = []
  page.on('request', (req) => {
    const isLogin = req.url().endsWith('/api/auth/apikey')
    const headers = JSON.stringify(req.headers())
    if (headers.includes(KEY)) leaks.push(`request headers ${req.url()}`)
    if (!isLogin && (req.postData() ?? '').includes(KEY)) leaks.push(`request body ${req.url()}`)
  })
  page.on('response', async (res) => {
    const headers = JSON.stringify(await res.allHeaders())
    if (headers.includes(KEY) || headers.toLowerCase().includes('bearer')) leaks.push(`response headers ${res.url()}`)
    if (res.request().resourceType() === 'eventsource' || res.url().endsWith('/stream')) return
    const body = await res.body().catch(() => Buffer.from(''))
    if (body.toString('utf8').includes(KEY)) leaks.push(`response body ${res.url()}`)
  })

  await signIn(page)
  await startChat(page, 'Use a tool please')
  await expect(assistantMessages(page).last()).toContainText('I searched and found 3 results')
  await page.goto('/settings')
  await expect(page.getByRole('heading', { name: 'Profile' })).toBeVisible()

  const html = await page.content()
  expect(html).not.toContain(KEY)
  const storage = await page.evaluate(() => ({
    cookie: document.cookie,
    local: JSON.stringify({ ...localStorage }),
    session: JSON.stringify({ ...sessionStorage }),
  }))
  expect(storage.cookie).not.toContain(KEY)
  expect(storage.cookie).not.toContain('agentry_session') // httpOnly: invisible to scripts
  expect(storage.local).not.toContain(KEY)
  expect(storage.session).not.toContain(KEY)
  for (const cookie of await context.cookies()) expect(cookie.value).not.toContain(KEY)
  const session = (await context.cookies()).find((c) => c.name.startsWith('agentry_session'))
  expect(session?.httpOnly).toBe(true)
  expect(leaks).toEqual([])
})

test('settings: theme and default model are remembered', async ({ page, context }) => {
  await signIn(page)
  await page.goto('/settings')
  await page.getByRole('radio', { name: 'Dark' }).click()
  await expect.poll(async () => (await context.cookies()).find((c) => c.name === 'agentry_theme')?.value).toBe('dark')
  await page.getByRole('combobox', { name: 'Default model for new chats' }).click()
  await page.getByRole('option', { name: 'mock-large' }).click()
  await expect(page.getByText('New chats will use mock-large.')).toBeVisible()
  await page.reload()
  await expect(page.getByRole('radio', { name: 'Dark' })).toBeChecked()
  await page.goto('/')
  await expect(page.getByRole('combobox', { name: 'Model' })).toContainText('mock-large')
})
