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

const { refreshIfNeeded, identityFromTokens } = await import('@/server/keycloak')
const { requireCredential, UnauthorizedError } = await import('@/server/require-auth')
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
})
afterEach(() => vi.unstubAllGlobals())

describe('refreshIfNeeded', () => {
  it('leaves a fresh token alone', async () => {
    const fresh = { ...credential, expiresAt: NOW + 61_000 }
    expect(await refreshIfNeeded(fresh, NOW)).toBe(fresh)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('refreshes 60s before expiry', async () => {
    fetchMock.mockResolvedValue(
      Response.json({ access_token: 'new-at', refresh_token: 'new-rt', id_token: 'new-id', expires_in: 300 }),
    )
    const result = await refreshIfNeeded({ ...credential, expiresAt: NOW + 60_000 }, NOW)

    expect(result).toEqual({ kind: 'keycloak', accessToken: 'new-at', refreshToken: 'new-rt', idToken: 'new-id', expiresAt: NOW + 300_000 })
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
    expect(result).toMatchObject({ accessToken: 'new-at', refreshToken: 'old-rt', idToken: 'old-id' })
  })

  it('returns null on a 400 refresh', async () => {
    fetchMock.mockResolvedValue(Response.json({ error: 'invalid_grant' }, { status: 400 }))
    expect(await refreshIfNeeded(credential, NOW)).toBeNull()
  })

  it('returns null when Keycloak is unreachable', async () => {
    fetchMock.mockRejectedValue(new TypeError('fetch failed'))
    expect(await refreshIfNeeded(credential, NOW)).toBeNull()
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
