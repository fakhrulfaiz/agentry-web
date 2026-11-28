import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { FakeCookieStore, mockState, sameOriginRequest, testConfig } from '../helpers/next-mocks'

vi.mock('next/headers', async () => {
  const h = await import('../helpers/next-mocks')
  return { cookies: async () => h.mockState.store, headers: async () => h.mockState.headers }
})
vi.mock('@/config/env', async () => {
  const h = await import('../helpers/next-mocks')
  return { getConfig: () => h.mockState.config }
})

const route = await import('../../app/api/agentry/connectors/key/route')
const proxy = await import('../../app/api/agentry/[...path]/route')
const store = await import('@/server/connectors-store')
const { getSession } = await import('@/server/session')

const CSRF = 'csrf-token-value'
const URL_ = 'http://web.test/api/agentry/connectors/key'
let dir: string
const fetchMock = vi.fn<typeof fetch>()

async function signIn() {
  const session = await getSession()
  session.credential = { kind: 'apikey', key: 'agk_test' }
  session.identity = { owner: 'alice', roles: [], displayName: 'Alice' }
  session.csrf = CSRF
  await session.save()
  mockState.store = mockState.store.next()
}

const put = (key: unknown, csrf = CSRF) =>
  route.PUT(sameOriginRequest(URL_, { method: 'PUT', csrf, body: JSON.stringify({ key }), headers: { 'content-type': 'application/json' } }))

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'connectors-route-'))
  process.env.AGENTRY_WEB_DATA_DIR = dir
  mockState.store = new FakeCookieStore()
  mockState.config = testConfig()
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
  await signIn()
})
afterEach(async () => {
  vi.unstubAllGlobals()
  delete process.env.AGENTRY_WEB_DATA_DIR
  await rm(dir, { recursive: true, force: true })
})

/** A fake Agentry API holding one Composio key for the signed-in credential. */
function fakeApi(options: { refuse?: { status: number; code: string } } = {}) {
  let stored: string | null = null
  const calls: Array<{ method: string; url: string; body?: unknown }> = []
  fetchMock.mockImplementation(async (input, init) => {
    const url = String(input)
    const method = init?.method ?? 'GET'
    const body = init?.body ? JSON.parse(String(init.body)) : undefined
    calls.push({ method, url, body })
    if (!url.endsWith('/v1/agents/connectors/composio')) return Response.json({ id: 's1' })
    if (options.refuse && method !== 'GET') return Response.json({ error: { code: options.refuse.code } }, { status: options.refuse.status })
    if (method === 'POST') stored = (body as { key: string }).key
    if (method === 'DELETE') stored = null
    return Response.json({ object: 'connector.key', configured: stored !== null, last4: stored?.slice(-4) ?? null, updated_at: stored ? 100 : null })
  })
  return { calls, stored: () => stored }
}

describe('/api/agentry/connectors/key', () => {
  it('forwards save, status and remove to the API and never returns the key', async () => {
    const api = fakeApi()
    let res = await route.GET()
    expect(await res.json()).toEqual({ configured: false, last4: null, updated_at: null })
    expect(res.headers.get('cache-control')).toBe('no-store')

    res = await put('ck_test_1234')
    expect(res.status).toBe(200)
    const text = await res.text()
    expect(text).not.toContain('ck_test_1234')
    expect(JSON.parse(text)).toEqual({ configured: true, last4: '1234', updated_at: 100 })
    expect(api.stored()).toBe('ck_test_1234')
    expect(api.calls.find((c) => c.method === 'POST')?.url).toBe('http://agentry.test/v1/agents/connectors/composio')
    expect(await store.hasKey('alice')).toBe(false)

    res = await route.DELETE(sameOriginRequest(URL_, { method: 'DELETE', csrf: CSRF }))
    expect(await res.json()).toMatchObject({ configured: false })
    expect(api.stored()).toBeNull()
  })

  it('moves a key from the old file store to the API once, then deletes the file entry', async () => {
    const api = fakeApi()
    await store.setKey('alice', 'ck_legacy_5678')
    const res = await route.GET()
    const text = await res.text()
    expect(text).not.toContain('ck_legacy_5678')
    expect(JSON.parse(text)).toMatchObject({ configured: true, last4: '5678' })
    expect(api.stored()).toBe('ck_legacy_5678')
    expect(await store.hasKey('alice')).toBe(false)
    await route.GET()
    expect(api.calls.filter((c) => c.method === 'POST')).toHaveLength(1)
  })

  it('keeps the file entry when the API refuses the move', async () => {
    fakeApi({ refuse: { status: 501, code: 'secrets_disabled' } })
    await store.setKey('alice', 'ck_legacy_5678')
    expect(await (await route.GET()).json()).toEqual({ configured: false, last4: null, updated_at: null })
    expect(await store.hasKey('alice')).toBe(true)
  })

  it('passes invalid_key and secrets_disabled through', async () => {
    fakeApi({ refuse: { status: 400, code: 'invalid_key' } })
    let res = await put('sk_nope')
    expect([res.status, (await res.json()).error]).toEqual([400, 'invalid_key'])
    expect((await put(5)).status).toBe(400)
    fakeApi({ refuse: { status: 501, code: 'secrets_disabled' } })
    res = await put('ck_test_1234')
    expect([res.status, (await res.json()).error]).toEqual([501, 'secrets_disabled'])
  })

  it('rejects PUT and DELETE without a valid CSRF token', async () => {
    const api = fakeApi()
    expect((await put('ck_test_123', 'wrong')).status).toBe(403)
    expect((await route.DELETE(sameOriginRequest(URL_, { method: 'DELETE' }))).status).toBe(403)
    expect(api.calls).toEqual([])
  })

  it('answers 401 when signed out', async () => {
    mockState.store = new FakeCookieStore()
    expect((await route.GET()).status).toBe(401)
  })

  it('forwards session create byte for byte, even with a key in the old file store', async () => {
    fakeApi()
    await store.setKey('alice', 'ck_test_123')
    const body = JSON.stringify({ agent: { model: 'm' } })
    await proxy.POST(
      sameOriginRequest('http://web.test/api/agentry/agents/sessions', { method: 'POST', csrf: CSRF, body, headers: { 'content-type': 'application/json' } }),
    )
    expect(String(Buffer.from(fetchMock.mock.calls[0][1]?.body as ArrayBuffer))).toBe(body)
  })
})
