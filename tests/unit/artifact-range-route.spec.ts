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

const { GET } = await import('../../app/api/agentry/agents/sessions/[id]/artifacts/[...path]/route')
const { getSession } = await import('@/server/session')

const fetchMock = vi.fn<typeof fetch>()

async function signIn() {
  const session = await getSession()
  session.credential = { kind: 'apikey', key: 'agk_test' }
  session.identity = { owner: '', roles: [], displayName: 'API key user' }
  session.csrf = 'c'
  await session.save()
  mockState.store = mockState.store.next()
}

const call = (path: string[], headers: Record<string, string> = {}) =>
  GET(new Request('http://web.test/x', { headers }), { params: Promise.resolve({ id: 'sess_1', path }) })
const bytes = () => new Response(new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]), { status: 200, headers: { 'content-length': '10' } })

beforeEach(async () => {
  mockState.store = new FakeCookieStore()
  mockState.config = testConfig()
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
  await signIn()
})
afterEach(() => vi.unstubAllGlobals())

describe('artifact bytes route: ranges (video seeking)', () => {
  it('serves a whole video inline with its type and accept-ranges', async () => {
    fetchMock.mockResolvedValue(bytes())
    const res = await call(['recordings', 'demo.webm'])
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('video/webm')
    expect(res.headers.get('accept-ranges')).toBe('bytes')
    expect(res.headers.get('content-length')).toBe('10')
  })

  it('answers a range with 206 and just those bytes', async () => {
    fetchMock.mockResolvedValue(bytes())
    const res = await call(['recordings', 'demo.webm'], { range: 'bytes=2-5' })
    expect(res.status).toBe(206)
    expect(res.headers.get('content-range')).toBe('bytes 2-5/10')
    expect(res.headers.get('content-length')).toBe('4')
    expect([...new Uint8Array(await res.arrayBuffer())]).toEqual([2, 3, 4, 5])
  })

  it('answers 416 past the end', async () => {
    fetchMock.mockResolvedValue(bytes())
    const res = await call(['recordings', 'demo.webm'], { range: 'bytes=10-' })
    expect(res.status).toBe(416)
    expect(res.headers.get('content-range')).toBe('bytes */10')
  })
})
