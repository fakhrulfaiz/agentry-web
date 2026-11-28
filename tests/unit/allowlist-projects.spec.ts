import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { isAllowed } from '@/server/allowlist'
import { FakeCookieStore, mockState, sameOriginRequest, testConfig } from '../helpers/next-mocks'

vi.mock('next/headers', async () => {
  const h = await import('../helpers/next-mocks')
  return { cookies: async () => h.mockState.store, headers: async () => h.mockState.headers }
})
vi.mock('@/config/env', async () => {
  const h = await import('../helpers/next-mocks')
  return { getConfig: () => h.mockState.config }
})

const proxy = await import('../../app/api/agentry/[...path]/route')
const { getSession } = await import('@/server/session')

const CSRF = 'csrf-token-value'
const BASE = 'http://web.test/api/agentry'
const fetchMock = vi.fn<typeof fetch>()

async function signIn() {
  const session = await getSession()
  session.credential = { kind: 'apikey', key: 'sk-upstream-key' }
  session.identity = { owner: '', roles: [], displayName: 'API key user' }
  session.csrf = CSRF
  await session.save()
  mockState.store = mockState.store.next()
}

function call(method: string, path: string, init: RequestInit & { csrf?: string } = {}) {
  const req = sameOriginRequest(`${BASE}${path}`, { method, ...init })
  return proxy[method as 'GET' | 'POST' | 'DELETE' | 'PUT' | 'PATCH'](req)
}

beforeEach(async () => {
  mockState.store = new FakeCookieStore()
  mockState.config = testConfig()
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
  await signIn()
})
afterEach(() => vi.unstubAllGlobals())

describe('projects proxy paths', () => {
  it('allows project read and state-changing proxy paths', () => {
    for (const [method, path] of [
      ['GET', '/agents/projects'],
      ['POST', '/agents/projects'],
      ['GET', '/agents/projects/p_1'],
      ['POST', '/agents/projects/p_1/archive'],
      ['POST', '/agents/projects/p_1/unarchive'],
      ['DELETE', '/agents/projects/p_1'],
    ]) {
      expect(isAllowed(method, path), `${method} ${path}`).toBe(true)
    }
  })

  it('rejects unknown project paths and methods', () => {
    for (const [method, path] of [
      ['PATCH', '/agents/projects/p_1'],
      ['GET', '/agents/projects/p_1/nope'],
      ['POST', '/agents/projects/p_1/nope'],
      ['DELETE', '/agents/projects'],
      ['PUT', '/agents/projects/p_1'],
      ['GET', '/agents/projects/a%2Fb'],
      ['GET', '/agents/projects/../p_1'],
    ]) {
      expect(isAllowed(method, path), `${method} ${path}`).toBe(false)
    }
  })

  it('requires csrf for project state changes', async () => {
    const body = JSON.stringify({ name: 'Project' })
    const headers = { 'content-type': 'application/json' }

    const forbidden = await call('POST', '/agents/projects', { body, headers })
    expect(forbidden.status).toBe(403)
    expect(fetchMock).not.toHaveBeenCalled()

    fetchMock.mockResolvedValue(Response.json({ id: 'p_1', object: 'project', name: 'Project' }))
    const allowed = await call('POST', '/agents/projects', { csrf: CSRF, body, headers })
    expect(allowed.status).toBe(200)
    expect(fetchMock).toHaveBeenCalledOnce()
    expect(String(fetchMock.mock.calls[0][0])).toBe('http://agentry.test/v1/agents/projects')

    fetchMock.mockClear()
    const archive = await call('POST', '/agents/projects/p_1/archive', { csrf: CSRF, body: '{}', headers })
    expect(archive.status).toBe(200)
    expect(String(fetchMock.mock.calls[0][0])).toBe('http://agentry.test/v1/agents/projects/p_1/archive')
  })
})
