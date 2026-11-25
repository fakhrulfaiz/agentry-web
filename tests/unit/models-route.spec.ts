import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { FakeCookieStore, mockState, testConfig } from '../helpers/next-mocks'

vi.mock('next/headers', async () => {
  const h = await import('../helpers/next-mocks')
  return { cookies: async () => h.mockState.store, headers: async () => h.mockState.headers }
})
vi.mock('@/config/env', async () => {
  const h = await import('../helpers/next-mocks')
  return { getConfig: () => h.mockState.config }
})

const { GET } = await import('../../app/api/models/route')
const { getSession } = await import('@/server/session')

const KEY = 'agk_test'
const fetchMock = vi.fn<typeof fetch>()

async function signIn() {
  const session = await getSession()
  session.credential = { kind: 'apikey', key: KEY }
  session.identity = { owner: '', roles: [], displayName: 'API key user' }
  session.csrf = 'c'
  await session.save()
  mockState.store = mockState.store.next()
}

const call = () => GET(new Request('http://web.test/api/models'))
const agents = (...models: string[]) =>
  Response.json({ object: 'list', data: models.map((model, i) => ({ id: `a${i}`, object: 'agent', model })), has_more: false })

beforeEach(async () => {
  mockState.store = new FakeCookieStore()
  mockState.config = testConfig({ models: ['m-default', 'm-other'] })
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
  await signIn()
})
afterEach(() => vi.unstubAllGlobals())

describe('GET /api/models', () => {
  it('lists configured models first, then distinct saved-agent models', async () => {
    fetchMock.mockResolvedValue(agents('m-saved', 'm-other', 'm-saved', 'm-new'))
    const res = await call()
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ models: ['m-default', 'm-other', 'm-saved', 'm-new'] })
    const [url, init] = fetchMock.mock.calls[0]
    expect(String(url)).toBe('http://agentry.test/v1/agents?limit=100')
    expect(new Headers(init?.headers).get('authorization')).toBe(`Bearer ${KEY}`)
    expect(new Headers(init?.headers).get('openai-beta')).toBe('agents=v1')
  })

  it('answers 401 without a session', async () => {
    mockState.store = new FakeCookieStore()
    const res = await call()
    expect(res.status).toBe(401)
    expect(await res.json()).toEqual({ error: 'signed_out' })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('clears the session when Agentry answers 401', async () => {
    fetchMock.mockResolvedValue(Response.json({ error: {} }, { status: 401 }))
    const res = await call()
    expect(res.status).toBe(401)
    mockState.store = mockState.store.next()
    expect((await getSession()).credential).toBeUndefined()
  })

  it('falls back to the configured list when Agentry fails, and 502 without one', async () => {
    fetchMock.mockRejectedValue(new TypeError('fetch failed'))
    expect(await (await call()).json()).toEqual({ models: ['m-default', 'm-other'] })

    mockState.config = testConfig({ models: [] })
    fetchMock.mockResolvedValue(Response.json({ error: {} }, { status: 503 }))
    const res = await call()
    expect(res.status).toBe(502)
  })
})
