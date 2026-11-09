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

/** Elements in the conversation that stick out of its column, and whether the page scrolls sideways. */
async function overflow(page: Page) {
  return page.evaluate(() => {
    const log = document.querySelector('[role="log"]')
    if (!log) return { missing: true, outside: [] as string[], pageScrolls: false }
    const column = log.getBoundingClientRect()
    const outside: string[] = []
    for (const el of Array.from(log.querySelectorAll('*'))) {
      const r = el.getBoundingClientRect()
      if (r.width <= 1 || r.height <= 1) continue // visually hidden helpers
      if (r.left < column.left - 1 || r.right > column.right + 1) outside.push(`${el.tagName}.${(el.className || '').toString().slice(0, 40)} ${Math.round(r.left)}-${Math.round(r.right)}`)
    }
    const root = document.scrollingElement ?? document.documentElement
    return { missing: false, outside, pageScrolls: root.scrollWidth > root.clientWidth }
  })
}

test('a web lookup shows thinking, tool cards and a streamed answer as it happens, in the column', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 })
  await signIn(page)
  await startChat(page, 'Look up the latest Node.js release on the web')

  // Live, before the turn ends: running reasoning, then tool cards from the items refresh.
  await expect(page.getByRole('button', { name: /Thinking…/ }).first()).toBeVisible()
  await expect(page.getByRole('button', { name: /web_search/ })).toBeVisible()
  await expect(page.getByRole('button', { name: /web_fetch/ })).toBeVisible()
  // The answer streams in: seen while still busy, then complete.
  await expect(page.locator('[data-testid="assistant-message"][aria-busy="true"]').filter({ hasText: 'The latest stable Node.js release' })).toBeVisible()
  await expect(assistantMessages(page).last()).toContainText('pre-release alpha')

  // Done: reasoning collapses to one line each; it is never shown as the answer.
  await expect(page.getByRole('button', { name: /Thinking…/ })).toHaveCount(0)
  await expect(page.getByRole('button', { name: /^Thought/ })).toHaveCount(3)
  await expect(assistantMessages(page)).toHaveCount(1)
  await expect(assistantMessages(page)).not.toContainText('Let me')

  for (const width of [1280, 390]) {
    await page.setViewportSize({ width, height: 900 })
    await expect.poll(() => overflow(page), { message: `overflow at ${width}px` }).toEqual({ missing: false, outside: [], pageScrolls: false })
    const header = page.getByTestId('reasoning-header').first()
    const label = header.getByText('Thought', { exact: true })
    // One line: the label is no taller than the header row.
    const [lb, hb] = [await label.boundingBox(), await header.boundingBox()]
    expect(lb && hb && lb.height <= hb.height + 1 && lb.height < 30).toBe(true)
  }

  // Reopened from history: the same, once.
  await page.setViewportSize({ width: 1280, height: 900 })
  await page.reload()
  await expect(assistantMessages(page).last()).toContainText('v26.13.0')
  await page.waitForTimeout(1000) // let the replay settle
  await expect(page.getByRole('button', { name: /^Thought/ })).toHaveCount(3)
  await expect(page.getByRole('button', { name: /web_search/ })).toHaveCount(1)
  await expect(page.getByRole('button', { name: /web_fetch/ })).toHaveCount(1)
  await expect(assistantMessages(page)).toHaveCount(1)
})

test('the Trajectory view shows the turn, its tool rows and an inspector, and reveals a record in the chat', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 })
  await signIn(page)
  await startChat(page, 'Look up the latest Node.js release on the web')
  await expect(assistantMessages(page).last()).toContainText('v26.13.0')
  const views = page.getByRole('navigation', { name: 'Views' })
  await views.getByRole('button', { name: 'Trajectory' }).click()
  await expect(composer(page)).toHaveCount(0)
  const turn = page.getByRole('region', { name: 'Turn 1' })
  for (const label of ['Input', 'Output', 'Think', 'Time']) await expect(turn.getByText(label, { exact: true })).toBeVisible()
  const fetchRow = page.getByTestId('trajectory-row').filter({ hasText: 'web_fetch' })
  await expect(fetchRow).toBeVisible()
  await expect(page.getByTestId('trajectory-span')).toHaveCount(1) // the turn; items have no timing

  await fetchRow.click()
  const details = page.getByRole('complementary', { name: 'Event details' })
  await expect(details.getByText('web_fetch', { exact: true })).toBeVisible()
  await expect(details.getByRole('region', { name: 'Timing' })).toContainText('Not recorded')

  for (const width of [1280, 390]) {
    await page.setViewportSize({ width, height: 900 })
    await expect.poll(() => page.evaluate(() => {
      const root = document.scrollingElement ?? document.documentElement
      return root.scrollWidth > root.clientWidth
    }), { message: `page scrolls sideways at ${width}px` }).toBe(false)
  }
  // Narrow: the details are a drawer; Show in chat goes back to the chat at that call.
  await page.getByRole('dialog', { name: 'Event details' }).getByRole('button', { name: 'Show in chat' }).click()
  await expect(composer(page)).toBeVisible()
  await expect(page.locator('[data-item-id]').filter({ has: page.getByRole('button', { name: /web_fetch/ }) })).toBeInViewport()

  // The chosen view is remembered for this chat.
  await views.getByRole('button', { name: 'Trajectory' }).click()
  await page.reload()
  await expect(page.getByRole('region', { name: 'Turn 1' })).toBeVisible()
})

test('a delegated subagent shows live status, then expands to its own activity', async ({ page }) => {
  await signIn(page)
  await startChat(page, 'Please delegate this to a subagent')
  await expect(assistantMessages(page).last()).toContainText('I asked a researcher')
  // The `subagent` tool card is there too; the subagent card is its own.
  await expect(page.getByRole('button', { name: /subagent Research the question/ })).toBeVisible()
  const header = page.getByTestId('subagent-card').getByRole('button', { name: /Research the question/ })
  // The parent turn is over; the child still works and the card follows it.
  await expect(header).toContainText('Working')
  await expect(header).toContainText('Done', { timeout: 15_000 })
  await expect(header).toContainText(/\d+s/)

  await header.click()
  const activity = page.getByTestId('subagent-activity')
  await expect(activity.getByRole('button', { name: /glob/ })).toBeVisible()
  await expect(activity.getByRole('button', { name: /^Thought/ })).toBeVisible()
  await expect(activity.getByTestId('assistant-message').last()).toContainText('Found 2 Markdown files')

  for (const width of [1280, 390]) {
    await page.setViewportSize({ width, height: 900 })
    await expect.poll(() => overflow(page), { message: `overflow at ${width}px` }).toEqual({ missing: false, outside: [], pageScrolls: false })
  }

  // Reopened: the card comes back from GET .../subagents, once.
  await page.reload()
  await expect(page.getByTestId('subagent-card')).toHaveCount(1)
  await expect(page.getByTestId('subagent-card')).toContainText('Done')
})

test('the chat title menu stars a chat; it stays under Starred after a reload', async ({ page }) => {
  await signIn(page)
  // A blank new chat has no title in its header.
  await expect(page.locator('header').first()).toHaveText('')
  await startChat(page, 'Keep this chat')
  await expect(assistantMessages(page).last()).toContainText('You said: Keep this chat')

  await page.getByRole('button', { name: 'Keep this chat', exact: true }).click()
  await page.getByRole('menuitem', { name: 'Star' }).click()
  const starred = page.getByRole('group', { name: 'Starred' })
  await expect(starred.getByRole('link', { name: 'Keep this chat' })).toBeVisible()

  await page.reload()
  await expect(starred.getByRole('link', { name: 'Keep this chat' })).toBeVisible()
  await expect(page.getByRole('group', { name: 'Today' })).toHaveCount(0)
  await page.getByRole('button', { name: 'Keep this chat', exact: true }).click()
  await expect(page.getByRole('menuitem', { name: 'Unstar' })).toBeVisible()
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
