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

const { GET } = await import('../../app/api/agentry/agents/sessions/[id]/renders/pdf/[...path]/route')
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

beforeEach(async () => {
  mockState.store = new FakeCookieStore()
  mockState.config = testConfig()
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
  await signIn()
})
afterEach(() => vi.unstubAllGlobals())

describe('GET office render route', () => {
  it('refuses a bad segment without calling the API', async () => {
    expect((await call(['..', 'x.pptx'])).status).toBe(404)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('passes the PDF with its etag and fonts, and forwards if-none-match', async () => {
    fetchMock.mockResolvedValue(new Response('%PDF-1.7', { status: 200, headers: { etag: '"12:3"', 'x-agentry-missing-fonts': 'Arial' } }))
    const res = await call(['docs', 'deck.pptx'], { 'if-none-match': '"12:2"' })
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('application/pdf')
    expect(res.headers.get('content-disposition')).toBe('inline; filename="deck.pdf"')
    expect(res.headers.get('etag')).toBe('"12:3"')
    expect(res.headers.get('x-agentry-missing-fonts')).toBe('Arial')
    expect(res.headers.get('cache-control')).toBe('private, no-cache')
    const [url, init] = fetchMock.mock.calls[0]
    expect(String(url)).toBe('http://agentry.test/v1/agents/sessions/sess_1/renders/pdf/docs/deck.pptx')
    expect(new Headers(init?.headers).get('if-none-match')).toBe('"12:2"')
    expect(new Headers(init?.headers).get('authorization')).toBe('Bearer agk_test')
  })

  it('passes 304 and error JSON through', async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 304, headers: { etag: '"1:1"' } }))
    const cached = await call(['a.docx'])
    expect(cached.status).toBe(304)
    expect(cached.headers.get('etag')).toBe('"1:1"')
    fetchMock.mockResolvedValueOnce(Response.json({ error: { code: 'render_timeout' } }, { status: 504 }))
    const timeout = await call(['a.docx'])
    expect(timeout.status).toBe(504)
    expect(await timeout.json()).toEqual({ error: { code: 'render_timeout' } })
  })

  it('signs out on an upstream 401', async () => {
    fetchMock.mockResolvedValue(new Response('{}', { status: 401 }))
    const res = await call(['a.docx'])
    expect(res.status).toBe(401)
  })
})
