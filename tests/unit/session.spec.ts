import { beforeEach, describe, expect, it, vi } from 'vitest'
import { FakeCookieStore, mockState, testConfig } from '../helpers/next-mocks'

vi.mock('next/headers', async () => {
  const h = await import('../helpers/next-mocks')
  return { cookies: async () => h.mockState.store, headers: async () => h.mockState.headers }
})
vi.mock('@/config/env', async () => {
  const h = await import('../helpers/next-mocks')
  return { getConfig: () => h.mockState.config }
})

const { getSession, publicIdentity, SESSION_COOKIE } = await import('@/server/session')

beforeEach(() => {
  mockState.store = new FakeCookieStore()
  mockState.config = testConfig()
  mockState.headers = new Headers()
})

describe('session cookie', () => {
  it('round-trips a credential through the encrypted cookie', async () => {
    const session = await getSession()
    session.credential = { kind: 'apikey', key: 'sk-secret' }
    session.identity = { owner: 'u1', roles: [], displayName: 'API key user' }
    session.csrf = 'token'
    await session.save()

    const sealed = mockState.store.get(SESSION_COOKIE)?.value ?? ''
    expect(sealed).not.toBe('')
    expect(sealed).not.toContain('sk-secret')

    mockState.store = mockState.store.next()
    const again = await getSession()
    expect(again.credential).toEqual({ kind: 'apikey', key: 'sk-secret' })
    expect(again.csrf).toBe('token')
  })

  it('tampered cookie reads as empty session', async () => {
    const session = await getSession()
    session.credential = { kind: 'apikey', key: 'sk-secret' }
    await session.save()
    const sealed = mockState.store.get(SESSION_COOKIE)!.value

    mockState.store = new FakeCookieStore()
    const flipped = sealed.slice(0, 20) + (sealed[20] === 'A' ? 'B' : 'A') + sealed.slice(21)
    mockState.store.jar.set(SESSION_COOKIE, flipped)
    const tampered = await getSession()
    expect(tampered.credential).toBeUndefined()

    mockState.store = new FakeCookieStore()
    mockState.store.jar.set(SESSION_COOKIE, 'garbage')
    expect((await getSession()).credential).toBeUndefined()
  })

  it('reads as empty when the secret was rotated', async () => {
    const session = await getSession()
    session.credential = { kind: 'apikey', key: 'sk-secret' }
    await session.save()
    mockState.store = mockState.store.next()
    mockState.config = testConfig({ sessionSecret: 'another-secret-that-is-at-least-32-bytes!!' })
    expect((await getSession()).credential).toBeUndefined()
  })

  it('sets HttpOnly, SameSite=Lax and no Secure outside production', async () => {
    const session = await getSession()
    session.csrf = 'x'
    await session.save()
    const write = mockState.store.writes.find((w) => w.name === SESSION_COOKIE)!
    expect(write.options).toMatchObject({ httpOnly: true, sameSite: 'lax', secure: false, path: '/' })
  })

  const secureFlag = async () => {
    const session = await getSession()
    session.csrf = 'x'
    await session.save()
    return mockState.store.writes.find((w) => w.name === SESSION_COOKIE)!.options
  }

  it('sets Secure in production when the request came over HTTPS', async () => {
    mockState.config = testConfig({ production: true })
    mockState.headers = new Headers({ 'x-forwarded-proto': 'https' })
    expect(await secureFlag()).toMatchObject({ httpOnly: true, sameSite: 'lax', secure: true })
  })

  it('leaves Secure off in production over plain HTTP, so a LAN address can sign in', async () => {
    mockState.config = testConfig({ production: true })
    mockState.headers = new Headers({ 'x-forwarded-proto': 'http' })
    expect(await secureFlag()).toMatchObject({ httpOnly: true, secure: false })
  })

  it('takes the first protocol a proxy chain forwards', async () => {
    mockState.config = testConfig({ production: true })
    mockState.headers = new Headers({ 'x-forwarded-proto': 'HTTPS, http' })
    expect(await secureFlag()).toMatchObject({ secure: true })
  })

  it('always sets Secure in production with AGENTRY_WEB_COOKIE_SECURE=always', async () => {
    mockState.config = testConfig({ production: true, cookieSecure: 'always' })
    mockState.headers = new Headers({ 'x-forwarded-proto': 'http' })
    expect(await secureFlag()).toMatchObject({ secure: true })
  })
})

describe('publicIdentity', () => {
  it('never includes the credential or CSRF token', () => {
    const identity = publicIdentity({
      credential: { kind: 'keycloak', accessToken: 'at', refreshToken: 'rt', expiresAt: 1, idToken: 'it' },
      identity: { owner: 'sub-1', roles: ['admin'], displayName: 'Ada' },
      csrf: 'csrf-token',
    })
    expect(identity).toEqual({ owner: 'sub-1', roles: ['admin'], displayName: 'Ada' })
    const serialized = JSON.stringify(identity)
    for (const secret of ['"at"', '"rt"', '"it"', 'csrf-token', 'credential']) expect(serialized).not.toContain(secret)
  })

  it('is null when signed out', () => {
    expect(publicIdentity({ csrf: 'x' })).toBeNull()
    expect(publicIdentity({ identity: { owner: 'o', roles: [], displayName: 'd' }, csrf: 'x' })).toBeNull()
  })
})
