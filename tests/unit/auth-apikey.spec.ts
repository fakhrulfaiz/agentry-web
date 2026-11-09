import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { FakeCookieStore, mockState, sameOriginRequest, testConfig } from '../helpers/next-mocks'

vi.mock('next/headers', async () => {
  const h = await import('../helpers/next-mocks')
  return { cookies: async () => h.mockState.store }
})
vi.mock('@/config/env', async () => {
  const h = await import('../helpers/next-mocks')
  return { getConfig: () => h.mockState.config }
})

const { POST: login } = await import('../../app/api/auth/apikey/route')
const { POST: logout } = await import('../../app/api/auth/logout/route')
const { getSession, SESSION_COOKIE } = await import('@/server/session')

const KEY = 'sk-agentry-very-secret-key'
const fetchMock = vi.fn<typeof fetch>()

function loginRequest(key: unknown, origin?: string) {
  return sameOriginRequest('http://web.test/api/auth/apikey', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(origin ? { origin } : {}) },
    body: JSON.stringify({ key }),
  })
}

beforeEach(() => {
  mockState.store = new FakeCookieStore()
  mockState.config = testConfig()
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => vi.unstubAllGlobals())

describe('POST /api/auth/apikey', () => {
  it('validates the key with Agentry, stores it, and never echoes it', async () => {
    fetchMock.mockResolvedValue(Response.json({ object: 'list', data: [] }))
    const res = await login(loginRequest(KEY))

    expect(res.status).toBe(303)
    expect(res.headers.get('location')).toBe('/')
    const text = await res.text()
    expect(text).not.toContain(KEY)
    expect(JSON.stringify([...res.headers])).not.toContain(KEY)

    const [url, init] = fetchMock.mock.calls[0]
    expect(String(url)).toBe('http://agentry.test/v1/agents?limit=1')
    const headers = new Headers(init?.headers)
    expect(headers.get('authorization')).toBe(`Bearer ${KEY}`)
    expect(headers.get('openai-beta')).toBe('agents=v1')

    const sealed = mockState.store.get(SESSION_COOKIE)?.value ?? ''
    expect(sealed).not.toContain(KEY)
    mockState.store = mockState.store.next()
    const session = await getSession()
    expect(session.credential).toEqual({ kind: 'apikey', key: KEY })
    expect(session.identity).toEqual({ owner: '', roles: [], displayName: 'API key user' })
    expect(session.csrf).toMatch(/^[A-Za-z0-9_-]{43}$/)
  })

  it('answers 401 invalid_key for a rejected key and stores nothing', async () => {
    fetchMock.mockResolvedValue(Response.json({ error: { type: 'authentication_error' } }, { status: 401 }))
    const res = await login(loginRequest('bad-key'))

    expect(res.status).toBe(401)
    expect(await res.json()).toEqual({ error: 'invalid_key' })
    expect(mockState.store.get(SESSION_COOKIE)).toBeUndefined()
    expect((await getSession()).credential).toBeUndefined()
  })

  it('rejects a cross-origin login without calling Agentry', async () => {
    const res = await login(loginRequest(KEY, 'http://evil.test'))
    expect(res.status).toBe(403)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('rejects a missing key', async () => {
    const res = await login(loginRequest(''))
    expect(res.status).toBe(400)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('is not available in keycloak mode', async () => {
    mockState.config = testConfig({
      auth: 'keycloak',
      keycloak: { issuer: 'http://kc.test/realms/agentry', clientId: 'agentry-web', clientSecret: 's' },
    })
    expect((await login(loginRequest(KEY))).status).toBe(404)
  })
})

describe('POST /api/auth/logout', () => {
  async function signedIn(credential: Parameters<typeof Object.assign>[1]) {
    const session = await getSession()
    Object.assign(session, credential, { csrf: 'csrf-token' })
    await session.save()
    mockState.store = mockState.store.next()
  }

  function logoutRequest(csrf?: string) {
    return sameOriginRequest('http://web.test/api/auth/logout', { method: 'POST', csrf })
  }

  it('clears the session in apikey mode', async () => {
    await signedIn({ credential: { kind: 'apikey', key: KEY }, identity: { owner: '', roles: [], displayName: 'x' } })
    const res = await logout(logoutRequest('csrf-token'))

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ redirectTo: '/login' })
    expect(mockState.store.get(SESSION_COOKIE)).toBeUndefined()
    mockState.store = mockState.store.next()
    expect((await getSession()).credential).toBeUndefined()
  })

  it('clears the session and ends the Keycloak session in keycloak mode', async () => {
    mockState.config = testConfig({
      auth: 'keycloak',
      keycloak: { issuer: 'http://kc.test/realms/agentry', clientId: 'agentry-web', clientSecret: 's' },
    })
    await signedIn({
      credential: { kind: 'keycloak', accessToken: 'at', refreshToken: 'rt', idToken: 'id-token', expiresAt: Date.now() + 600_000 },
      identity: { owner: 'sub', roles: [], displayName: 'Ada' },
    })
    mockState.store.jar.set('authjs.session-token', 'jwt')
    const res = await logout(logoutRequest('csrf-token'))

    expect(res.status).toBe(200)
    const { redirectTo } = (await res.json()) as { redirectTo: string }
    const url = new URL(redirectTo)
    expect(url.origin + url.pathname).toBe('http://kc.test/realms/agentry/protocol/openid-connect/logout')
    expect(url.searchParams.get('id_token_hint')).toBeNull()
    expect(url.searchParams.get('client_id')).toBe('agentry-web')
    expect(url.searchParams.get('post_logout_redirect_uri')).toBe('http://web.test/login')
    expect(redirectTo).not.toContain('id-token')
    expect(mockState.store.get(SESSION_COOKIE)).toBeUndefined()
    expect(mockState.store.get('authjs.session-token')).toBeUndefined()
  })

  it('builds post_logout_redirect_uri from the forwarded origin behind a proxy', async () => {
    mockState.config = testConfig({
      auth: 'keycloak',
      keycloak: { issuer: 'http://kc.test/realms/agentry', clientId: 'agentry-web', clientSecret: 's' },
    })
    await signedIn({
      credential: { kind: 'keycloak', accessToken: 'at', refreshToken: 'rt', idToken: 'id-token', expiresAt: Date.now() + 600_000 },
      identity: { owner: 'sub', roles: [], displayName: 'Ada' },
    })
    const req = sameOriginRequest('http://10.0.0.5:3000/api/auth/logout', {
      method: 'POST',
      csrf: 'csrf-token',
      headers: { origin: 'https://chat.example.com', 'x-forwarded-host': 'chat.example.com', 'x-forwarded-proto': 'https' },
    })
    const res = await logout(req)

    expect(res.status).toBe(200)
    const { redirectTo } = (await res.json()) as { redirectTo: string }
    expect(new URL(redirectTo).searchParams.get('post_logout_redirect_uri')).toBe('https://chat.example.com/login')
  })

  it('requires the CSRF header', async () => {
    await signedIn({ credential: { kind: 'apikey', key: KEY } })
    const res = await logout(logoutRequest())
    expect(res.status).toBe(403)
    expect(mockState.store.get(SESSION_COOKIE)).toBeDefined()
  })
})
