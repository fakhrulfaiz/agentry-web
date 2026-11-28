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

const { mintPreviewToken, verifyPreviewToken } = await import('@/server/preview-token')
const mint = await import('../../app/api/preview/route')
const preview = await import('../../app/preview/[token]/[[...path]]/route')
const { getSession } = await import('@/server/session')

const KEY = 'agk_secret_key'
const CSRF = 'csrf-token-value'
const SECRET = 's'.repeat(40)
const fetchMock = vi.fn<typeof fetch>()

beforeEach(async () => {
  mockState.store = new FakeCookieStore()
  mockState.config = testConfig()
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
  const session = await getSession()
  session.credential = { kind: 'apikey', key: KEY }
  session.identity = { owner: '', roles: [], displayName: 'API key user' }
  session.csrf = CSRF
  await session.save()
  mockState.store = mockState.store.next()
})
afterEach(() => vi.unstubAllGlobals())

describe('preview token', () => {
  const grant = { authorization: `Bearer ${KEY}`, environment: 'env_1', port: 8765 }

  it('round-trips, hides the credential, and rejects expiry, tampering and another secret', async () => {
    const { token, exp } = await mintPreviewToken(grant, 60_000, 1_000, SECRET)
    expect(token).not.toContain(KEY)
    expect(await verifyPreviewToken(token, 2_000, SECRET)).toEqual({ ...grant, exp })
    expect(await verifyPreviewToken(token, exp, SECRET)).toBeNull()
    expect(await verifyPreviewToken(`${token.slice(0, -4)}AAAA`, 2_000, SECRET)).toBeNull()
    expect(await verifyPreviewToken(token, 2_000, 'x'.repeat(40))).toBeNull()
    expect(await verifyPreviewToken('nonsense', 2_000, SECRET)).toBeNull()
  })

  it('never lasts longer than an hour', async () => {
    const { exp } = await mintPreviewToken(grant, 99 * 3_600_000, 0, SECRET)
    expect(exp).toBe(3_600_000)
  })
})

describe('POST /api/preview', () => {
  const post = (body: unknown, csrf: string | null = CSRF) =>
    mint.POST(sameOriginRequest('http://web.test/api/preview', { method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json', ...(csrf ? { 'x-agentry-csrf': csrf } : {}) } }))

  it('needs the CSRF token and validates the environment and port', async () => {
    expect((await post({ environment: 'env_1', port: 8765 }, null)).status).toBe(403)
    expect((await post({ environment: 'agent_1', port: 8765 })).status).toBe(400)
    expect((await post({ environment: 'env_1', port: 70000 })).status).toBe(400)
    const ok = await post({ environment: 'env_1', port: 8765 })
    expect(ok.status).toBe(200)
    const { url } = (await ok.json()) as { url: string }
    expect(url).toMatch(/^\/preview\/.+\/$/)
    expect(url).not.toContain(KEY)
  })
})

describe('GET /preview/<token>/<path>', () => {
  async function tokenUrl(): Promise<string> {
    const res = await mint.POST(sameOriginRequest('http://web.test/api/preview', { method: 'POST', body: JSON.stringify({ environment: 'env_1', port: 8765 }), headers: { 'content-type': 'application/json', 'x-agentry-csrf': CSRF } }))
    return ((await res.json()) as { url: string }).url
  }
  const call = async (path: string[], init: RequestInit = {}) => {
    const base = await tokenUrl()
    const token = base.split('/')[2]!
    return { token, res: await preview.GET(new Request(`http://web.test${base}${path.join('/')}`, init), { params: Promise.resolve({ token, path }) }) }
  }

  it('serves the app through Agentry with the token credential, never the browser cookies, and isolates the page', async () => {
    fetchMock.mockResolvedValue(new Response('<h1>hi</h1>', { status: 200, headers: { 'content-type': 'text/html', 'set-cookie': 'a=b', location: '/next' } }))
    const { res, token } = await call(['a', 'b.html'], { headers: { cookie: 'agentry_session=secret', accept: 'text/html' } })
    expect(await res.text()).toBe('<h1>hi</h1>')
    const [url, init] = fetchMock.mock.calls[0]!
    expect(String(url)).toBe('http://agentry.test/v1/agents/environments/env_1/ports/8765/a/b.html')
    const sent = new Headers((init as RequestInit).headers)
    expect(sent.get('authorization')).toBe(`Bearer ${KEY}`)
    expect(sent.get('cookie')).toBeNull()
    expect(sent.get('accept')).toBe('text/html')
    expect(res.headers.get('content-security-policy')).toContain('sandbox allow-scripts')
    expect(res.headers.get('content-security-policy')).not.toContain('allow-same-origin')
    expect(res.headers.get('x-content-type-options')).toBe('nosniff')
    expect(res.headers.get('referrer-policy')).toBe('no-referrer')
    expect(res.headers.get('set-cookie')).toBeNull()
    expect(res.headers.get('location')).toBe(`/preview/${token}/next`)
  })

  it('refuses a bad token without calling Agentry, and the refusal is isolated too', async () => {
    const res = await preview.GET(new Request('http://web.test/preview/bad/'), { params: Promise.resolve({ token: 'bad', path: [] }) })
    expect(res.status).toBe(404)
    expect(res.headers.get('content-security-policy')).toContain('sandbox')
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
