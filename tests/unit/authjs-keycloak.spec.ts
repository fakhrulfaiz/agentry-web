// The Keycloak sign-in path through Auth.js's real route handlers: csrf → sign-in →
// callback, with discovery and the token exchange mocked at `fetch`.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { FakeCookieStore, mockState, testConfig } from '../helpers/next-mocks'

vi.mock('next/headers', async () => {
  const h = await import('../helpers/next-mocks')
  return { cookies: async () => h.mockState.store, headers: async () => new Headers() }
})
vi.mock('@/config/env', async () => {
  const h = await import('../helpers/next-mocks')
  return { getConfig: () => h.mockState.config }
})

const { handlers } = await import('@/server/authjs')
const { getSession, SESSION_COOKIE } = await import('@/server/session')
const { decode } = await import('next-auth/jwt')
const { createHash } = await import('node:crypto')

const ISSUER = 'http://kc.test/realms/agentry'
const ORIGIN = 'http://web.test'
const NOW_S = Math.floor(Date.now() / 1000)

function jwt(claims: object): string {
  const part = (v: object) => Buffer.from(JSON.stringify(v)).toString('base64url')
  return `${part({ alg: 'RS256', typ: 'JWT', kid: 'k1' })}.${part(claims)}.c2ln`
}

const ACCESS = jwt({ sub: 'user-1', realm_access: { roles: ['user'] }, preferred_username: 'ada', iss: ISSUER, exp: NOW_S + 300 })
const ID = jwt({ sub: 'user-1', iss: ISSUER, aud: 'agentry-web', azp: 'agentry-web', exp: NOW_S + 300, iat: NOW_S, name: 'Ada Lovelace' })
const REFRESH = 'refresh-token-value'

const fetchMock = vi.fn<typeof fetch>()
let tokenResponse: Record<string, unknown>

/** Cookie jar the "browser" keeps across the Auth.js requests (Auth.js's own cookies come back in Set-Cookie). */
const jar = new Map<string, string>()
function absorb(res: Response) {
  for (const line of res.headers.getSetCookie()) {
    const [pair] = line.split(';')
    const eq = pair.indexOf('=')
    const name = pair.slice(0, eq)
    const value = pair.slice(eq + 1)
    if (/max-age=0|expires=thu, 01 jan 1970/i.test(line) || value === '') jar.delete(name)
    else jar.set(name, value)
  }
}
function cookieHeader(): string {
  return [...jar, ...mockState.store.jar].map(([n, v]) => `${n}=${v}`).join('; ')
}
function request(path: string, init: RequestInit = {}): Request {
  const headers = new Headers(init.headers)
  headers.set('cookie', cookieHeader())
  headers.set('host', 'web.test')
  return new Request(`${ORIGIN}${path}`, { ...init, headers })
}

beforeEach(() => {
  jar.clear()
  mockState.store = new FakeCookieStore()
  mockState.config = testConfig({
    auth: 'keycloak',
    keycloak: { issuer: ISSUER, clientId: 'agentry-web', clientSecret: 'client-secret' },
  })
  tokenResponse = { access_token: ACCESS, refresh_token: REFRESH, id_token: ID, token_type: 'Bearer', expires_in: 300 }
  fetchMock.mockReset()
  fetchMock.mockImplementation(async (input) => {
    const url = String(input instanceof Request ? input.url : input)
    if (url === `${ISSUER}/.well-known/openid-configuration`) {
      return Response.json({
        issuer: ISSUER,
        authorization_endpoint: `${ISSUER}/protocol/openid-connect/auth`,
        token_endpoint: `${ISSUER}/protocol/openid-connect/token`,
        userinfo_endpoint: `${ISSUER}/protocol/openid-connect/userinfo`,
        jwks_uri: `${ISSUER}/protocol/openid-connect/certs`,
        end_session_endpoint: `${ISSUER}/protocol/openid-connect/logout`,
        id_token_signing_alg_values_supported: ['RS256'],
        code_challenge_methods_supported: ['S256'],
      })
    }
    if (url === `${ISSUER}/protocol/openid-connect/token`) return Response.json(tokenResponse)
    return new Response('unexpected', { status: 500 })
  })
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => vi.unstubAllGlobals())

/** Runs csrf → POST sign-in → Keycloak "redirects back" → callback; returns the callback response. */
async function signInThroughKeycloak(): Promise<Response> {
  const csrfRes = await handlers.GET(request('/api/auth/csrf') as never)
  absorb(csrfRes)
  const { csrfToken } = (await csrfRes.json()) as { csrfToken: string }

  const signInRes = await handlers.POST(
    request('/api/auth/signin/keycloak', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ csrfToken, callbackUrl: `${ORIGIN}/` }),
    }) as never,
  )
  absorb(signInRes)
  const authorize = new URL(signInRes.headers.get('location') ?? '')
  expect(authorize.origin + authorize.pathname).toBe(`${ISSUER}/protocol/openid-connect/auth`)
  expect(authorize.searchParams.get('code_challenge_method')).toBe('S256')
  const state = authorize.searchParams.get('state') ?? ''
  expect(state).not.toBe('')

  const callback = await handlers.GET(request(`/api/auth/callback/keycloak?code=auth-code&state=${encodeURIComponent(state)}`) as never)
  absorb(callback)
  return callback
}

describe('Keycloak sign-in through Auth.js', () => {
  it('writes the tokens into the encrypted session cookie and redirects into the app', async () => {
    const res = await signInThroughKeycloak()

    expect(res.status).toBe(302)
    expect(res.headers.get('location')).toBe(`${ORIGIN}/`)
    // The code was exchanged once, with PKCE.
    const tokenCalls = fetchMock.mock.calls.filter(([u]) => String(u).endsWith('/protocol/openid-connect/token'))
    expect(tokenCalls).toHaveLength(1)
    const body = new URLSearchParams(String(tokenCalls[0][1]?.body))
    expect(body.get('code')).toBe('auth-code')
    expect(body.get('code_verifier')).toBeTruthy()

    // iron-session wrote the session through `cookies()` during the callback.
    const sessionWrites = mockState.store.writes.filter((w) => w.name.startsWith(SESSION_COOKIE))
    expect(sessionWrites.length).toBeGreaterThan(0)
    for (const w of sessionWrites) {
      expect(w.options).toMatchObject({ httpOnly: true, sameSite: 'lax', path: '/' })
      expect(w.value).not.toContain(REFRESH)
    }
    mockState.store = mockState.store.next()
    const session = await getSession()
    expect(session.credential).toMatchObject({ kind: 'keycloak', accessToken: ACCESS, refreshToken: REFRESH, idToken: ID })
    expect(session.identity).toEqual({ owner: 'user-1', roles: ['user'], displayName: 'Ada Lovelace' })
    expect(session.csrf).toMatch(/^[A-Za-z0-9_-]{43}$/)
  })

  it('keeps only the subject in the Auth.js JWT and no token in its response', async () => {
    const res = await signInThroughKeycloak()

    const headerDump = JSON.stringify([...res.headers])
    for (const secret of [ACCESS, REFRESH, ID]) expect(headerDump).not.toContain(secret)

    const name = [...jar.keys()].find((n) => /^(__Secure-)?authjs\.session-token$/.test(n))
    expect(name).toBeDefined()
    const secret = createHash('sha256').update(`authjs:${mockState.config.sessionSecret}`).digest('hex')
    const claims = await decode({ token: jar.get(name!), secret, salt: name! })
    expect(claims).not.toBeNull()
    const keys = Object.keys(claims ?? {}).filter((k) => !['iat', 'exp', 'jti'].includes(k))
    expect(keys).toEqual(['sub'])
    expect(JSON.stringify(claims)).not.toContain(REFRESH)
  })

  it('refuses the sign-in and stores nothing when Keycloak omits the refresh token', async () => {
    delete tokenResponse.refresh_token
    const res = await signInThroughKeycloak()

    expect(res.status).toBe(302)
    expect(res.headers.get('location')).toMatch(/^http:\/\/web\.test\/login\?error=/)
    expect(mockState.store.writes.filter((w) => w.name.startsWith(SESSION_COOKIE))).toHaveLength(0)
  })

  it('falls back to expires_in when the token response has no expires_at', async () => {
    tokenResponse.expires_in = 120
    const before = Date.now()
    await signInThroughKeycloak()
    mockState.store = mockState.store.next()
    const credential = (await getSession()).credential
    expect(credential?.kind).toBe('keycloak')
    const expiresAt = credential?.kind === 'keycloak' ? credential.expiresAt : 0
    expect(expiresAt).toBeGreaterThanOrEqual(before + 119_000)
    expect(expiresAt).toBeLessThanOrEqual(Date.now() + 121_000)
  })
})
