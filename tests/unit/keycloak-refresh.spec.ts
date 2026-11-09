import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { FakeCookieStore, mockState, testConfig } from '../helpers/next-mocks'

vi.mock('next/headers', async () => {
  const h = await import('../helpers/next-mocks')
  return { cookies: async () => h.mockState.store }
})
vi.mock('@/config/env', async () => {
  const h = await import('../helpers/next-mocks')
  return { getConfig: () => h.mockState.config }
})

const { refreshIfNeeded, identityFromTokens, resetRefreshes } = await import('@/server/keycloak')
const { requireCredential, authFailure, AuthUnavailableError, UnauthorizedError } = await import('@/server/require-auth')
const { getSession } = await import('@/server/session')

const NOW = 1_800_000_000_000
const fetchMock = vi.fn<typeof fetch>()
const credential = {
  kind: 'keycloak' as const,
  accessToken: 'old-at',
  refreshToken: 'old-rt',
  idToken: 'old-id',
  expiresAt: NOW + 30_000,
}

beforeEach(() => {
  mockState.store = new FakeCookieStore()
  mockState.config = testConfig({
    auth: 'keycloak',
    keycloak: { issuer: 'http://kc.test/realms/agentry', clientId: 'agentry-web', clientSecret: 'client-secret' },
  })
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
  resetRefreshes()
})
afterEach(() => vi.unstubAllGlobals())

describe('refreshIfNeeded', () => {
  it('leaves a fresh token alone', async () => {
    const fresh = { ...credential, expiresAt: NOW + 61_000 }
    expect(await refreshIfNeeded(fresh, NOW)).toEqual({ status: 'ok', credential: fresh })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('refreshes 60s before expiry', async () => {
    fetchMock.mockResolvedValue(
      Response.json({ access_token: 'new-at', refresh_token: 'new-rt', id_token: 'new-id', expires_in: 300 }),
    )
    const result = await refreshIfNeeded({ ...credential, expiresAt: NOW + 60_000 }, NOW)

    expect(result).toEqual({
      status: 'ok',
      credential: { kind: 'keycloak', accessToken: 'new-at', refreshToken: 'new-rt', idToken: 'new-id', expiresAt: NOW + 300_000 },
    })
    const [url, init] = fetchMock.mock.calls[0]
    expect(String(url)).toBe('http://kc.test/realms/agentry/protocol/openid-connect/token')
    const body = new URLSearchParams(String(init?.body))
    expect(Object.fromEntries(body)).toEqual({
      grant_type: 'refresh_token',
      refresh_token: 'old-rt',
      client_id: 'agentry-web',
      client_secret: 'client-secret',
    })
  })

  it('keeps the old refresh and id tokens when Keycloak omits them', async () => {
    fetchMock.mockResolvedValue(Response.json({ access_token: 'new-at', expires_in: 60 }))
    const result = await refreshIfNeeded(credential, NOW)
    expect(result).toMatchObject({ status: 'ok', credential: { accessToken: 'new-at', refreshToken: 'old-rt', idToken: 'old-id' } })
  })

  it('is rejected on a 400 invalid_grant or a 401', async () => {
    fetchMock.mockResolvedValueOnce(Response.json({ error: 'invalid_grant' }, { status: 400 }))
    expect(await refreshIfNeeded(credential, NOW)).toEqual({ status: 'rejected' })
    fetchMock.mockResolvedValueOnce(Response.json({ error: 'unauthorized_client' }, { status: 401 }))
    expect(await refreshIfNeeded(credential, NOW)).toEqual({ status: 'rejected' })
  })

  it('is unavailable when Keycloak is unreachable, failing or answers garbage', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('fetch failed'))
    expect(await refreshIfNeeded(credential, NOW)).toEqual({ status: 'unavailable' })
    fetchMock.mockResolvedValueOnce(new Response('bad gateway', { status: 502 }))
    expect(await refreshIfNeeded(credential, NOW)).toEqual({ status: 'unavailable' })
    fetchMock.mockResolvedValueOnce(Response.json({ error: 'temporarily_unavailable' }, { status: 503 }))
    expect(await refreshIfNeeded(credential, NOW)).toEqual({ status: 'unavailable' })
    fetchMock.mockResolvedValueOnce(new Response('<html>', { status: 200 }))
    expect(await refreshIfNeeded(credential, NOW)).toEqual({ status: 'unavailable' })
  })

  it('shares one token call between concurrent refreshes of the same refresh token', async () => {
    let release!: (r: Response) => void
    fetchMock.mockReturnValueOnce(new Promise<Response>((resolve) => (release = resolve)))
    const calls = [refreshIfNeeded(credential, NOW), refreshIfNeeded(credential, NOW), refreshIfNeeded(credential, NOW)]
    release(Response.json({ access_token: 'new-at', refresh_token: 'new-rt', expires_in: 300 }))
    const results = await Promise.all(calls)

    expect(fetchMock).toHaveBeenCalledTimes(1)
    for (const r of results) expect(r).toMatchObject({ status: 'ok', credential: { accessToken: 'new-at', refreshToken: 'new-rt' } })
    // A late request still carrying the old refresh token reuses the result instead of spending it again.
    expect(await refreshIfNeeded(credential, NOW + 1_000)).toMatchObject({ status: 'ok', credential: { accessToken: 'new-at' } })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('does not keep a failed refresh, so the next request tries again', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('fetch failed'))
    expect(await refreshIfNeeded(credential, NOW)).toEqual({ status: 'unavailable' })
    fetchMock.mockResolvedValueOnce(Response.json({ access_token: 'new-at', expires_in: 300 }))
    expect(await refreshIfNeeded(credential, NOW)).toMatchObject({ status: 'ok' })
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })
})

describe('requireCredential', () => {
  it('throws UnauthorizedError when signed out', async () => {
    await expect(requireCredential()).rejects.toBeInstanceOf(UnauthorizedError)
  })

  it('returns the bearer for an apikey session', async () => {
    const session = await getSession()
    session.credential = { kind: 'apikey', key: 'sk-1' }
    await session.save()
    mockState.store = mockState.store.next()
    expect((await requireCredential()).authorization).toBe('Bearer sk-1')
  })

  it('clears the session when the refresh fails', async () => {
    const session = await getSession()
    session.credential = { ...credential, expiresAt: Date.now() - 1 }
    session.csrf = 'c'
    await session.save()
    mockState.store = mockState.store.next()
    fetchMock.mockResolvedValue(Response.json({ error: 'invalid_grant' }, { status: 400 }))

    await expect(requireCredential()).rejects.toBeInstanceOf(UnauthorizedError)
    mockState.store = mockState.store.next()
    expect((await getSession()).credential).toBeUndefined()
  })

  it('keeps the session and throws AuthUnavailableError when Keycloak is down', async () => {
    const session = await getSession()
    session.credential = { ...credential, expiresAt: Date.now() - 1 }
    session.csrf = 'c'
    await session.save()
    mockState.store = mockState.store.next()
    fetchMock.mockResolvedValue(new Response('unavailable', { status: 503 }))

    const error = await requireCredential().catch((e: unknown) => e)
    expect(error).toBeInstanceOf(AuthUnavailableError)
    const res = authFailure(error)
    expect(res.status).toBe(503)
    expect(await res.json()).toEqual({ error: 'auth_unavailable' })

    fetchMock.mockRejectedValue(new TypeError('fetch failed'))
    await expect(requireCredential()).rejects.toBeInstanceOf(AuthUnavailableError)
    mockState.store = mockState.store.next()
    expect((await getSession()).credential).toMatchObject({ accessToken: 'old-at', refreshToken: 'old-rt' })
  })

  it('two parallel requests near expiry refresh once and both succeed under refresh-token rotation', async () => {
    const session = await getSession()
    session.credential = { ...credential, expiresAt: Date.now() - 1 }
    await session.save()
    const cookies = mockState.store.next()
    // Keycloak with "Revoke Refresh Token": the first use of old-rt succeeds, any later use is invalid_grant.
    let used = false
    fetchMock.mockImplementation(async () => {
      await new Promise((r) => setTimeout(r, 5))
      if (used) return Response.json({ error: 'invalid_grant' }, { status: 400 })
      used = true
      return Response.json({ access_token: 'new-at', refresh_token: 'new-rt', expires_in: 300 })
    })

    // Two route handlers, each with its own request cookie store carrying the same session.
    const run = async () => {
      mockState.store = cookies.next()
      return requireCredential()
    }
    const [a, b] = await Promise.all([run(), run()])

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(a.authorization).toBe('Bearer new-at')
    expect(b.authorization).toBe('Bearer new-at')
  })

  it('saves a refreshed token', async () => {
    const session = await getSession()
    session.credential = { ...credential, expiresAt: Date.now() - 1 }
    await session.save()
    mockState.store = mockState.store.next()
    fetchMock.mockResolvedValue(Response.json({ access_token: 'new-at', expires_in: 300 }))

    expect((await requireCredential()).authorization).toBe('Bearer new-at')
    mockState.store = mockState.store.next()
    expect((await getSession()).credential).toMatchObject({ accessToken: 'new-at' })
  })
})

describe('identityFromTokens', () => {
  it('uses sub as owner and realm roles', () => {
    const jwt = (claims: object) => `h.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.s`
    const identity = identityFromTokens(
      jwt({ sub: 'user-1', realm_access: { roles: ['admin', 'user'] }, preferred_username: 'ada' }),
    )
    expect(identity).toEqual({ owner: 'user-1', roles: ['admin', 'user'], displayName: 'ada' })
  })
})
