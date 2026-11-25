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

describe('/api/agentry/connectors/key', () => {
  it('saves, reports and removes a key without returning it', async () => {
    let res = await route.GET()
    expect(await res.json()).toEqual({ configured: false })
    expect(res.headers.get('cache-control')).toBe('no-store')

    res = await put('ck_test_123')
    expect(res.status).toBe(200)
    expect(JSON.stringify(await res.json())).not.toContain('ck_test_123')
    expect(await store.getKey('alice')).toBe('ck_test_123')
    expect(await (await route.GET()).json()).toEqual({ configured: true })

    res = await route.DELETE(sameOriginRequest(URL_, { method: 'DELETE', csrf: CSRF }))
    expect(res.status).toBe(200)
    expect(await store.hasKey('alice')).toBe(false)
  })

  it('rejects an invalid key with 400', async () => {
    expect((await put('sk_nope')).status).toBe(400)
    expect((await put(5)).status).toBe(400)
  })

  it('rejects PUT and DELETE without a valid CSRF token', async () => {
    expect((await put('ck_test_123', 'wrong')).status).toBe(403)
    expect((await route.DELETE(sameOriginRequest(URL_, { method: 'DELETE' }))).status).toBe(403)
    expect(await store.hasKey('alice')).toBe(false)
  })

  it('answers 401 when signed out', async () => {
    mockState.store = new FakeCookieStore()
    expect((await route.GET()).status).toBe(401)
  })

  it('injects the stored key into session create and honors the URL override', async () => {
    await store.setKey('alice', 'ck_test_123')
    process.env.AGENTRY_WEB_COMPOSIO_MCP_URL = 'http://mcp.test/x'
    fetchMock.mockResolvedValue(Response.json({ id: 's1' }))
    try {
      await proxy.POST(
        sameOriginRequest('http://web.test/api/agentry/agents/sessions', {
          method: 'POST',
          csrf: CSRF,
          body: JSON.stringify({ agent: { model: 'm' } }),
          headers: { 'content-type': 'application/json' },
        }),
      )
    } finally {
      delete process.env.AGENTRY_WEB_COMPOSIO_MCP_URL
    }
    const sent = JSON.parse(String(Buffer.from(fetchMock.mock.calls[0][1]?.body as ArrayBuffer)))
    expect(sent.agent.tools[0].transport).toEqual({ type: 'http', server_url: 'http://mcp.test/x', headers: { 'x-consumer-api-key': 'ck_test_123' } })
  })

  it('forwards session create unchanged without a key', async () => {
    fetchMock.mockResolvedValue(Response.json({ id: 's1' }))
    const body = JSON.stringify({ agent: { model: 'm' } })
    await proxy.POST(
      sameOriginRequest('http://web.test/api/agentry/agents/sessions', { method: 'POST', csrf: CSRF, body, headers: { 'content-type': 'application/json' } }),
    )
    expect(String(Buffer.from(fetchMock.mock.calls[0][1]?.body as ArrayBuffer))).toBe(body)
  })
})
