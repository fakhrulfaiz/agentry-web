// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { api, ApiError, isSignedOut, titleFrom } from '@/api/client'

const fetchMock = vi.fn<typeof fetch>()
const CSRF = 'meta-token'

beforeEach(() => {
  document.head.innerHTML = `<meta name="agentry-csrf" content="${CSRF}">`
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => vi.unstubAllGlobals())

const lastCall = () => {
  const [url, init] = fetchMock.mock.calls.at(-1)!
  return { url: String(url), method: init?.method, headers: new Headers(init?.headers), body: init?.body ? JSON.parse(String(init.body)) : undefined }
}

describe('api client', () => {
  it('sends the CSRF token from the meta tag and calls the BFF paths', async () => {
    fetchMock.mockResolvedValue(Response.json({ id: 's1', status: 'in_progress' }))
    await api.createSession({ text: '  Plan   a trip\nto Penang ', model: 'm1' })
    expect(lastCall()).toMatchObject({
      url: '/api/agentry/agents/sessions',
      method: 'POST',
      body: { agent: { model: 'm1' }, input: '  Plan   a trip\nto Penang ', metadata: { title: 'Plan a trip to Penang' } },
    })
    expect(lastCall().headers.get('x-agentry-csrf')).toBe(CSRF)
    expect(lastCall().headers.get('authorization')).toBeNull()

    fetchMock.mockResolvedValue(Response.json({ object: 'list', data: [], first_id: null, last_id: null, has_more: false }))
    await api.listSessions({ after: 's9', limit: 20 })
    expect(lastCall()).toMatchObject({ url: '/api/agentry/agents/sessions?after=s9&limit=20', method: 'GET' })

    fetchMock.mockResolvedValue(new Response(null, { status: 200 }))
    await api.deleteSession('s1')
    expect(lastCall()).toMatchObject({ url: '/api/agentry/agents/sessions/s1', method: 'DELETE' })
  })

  it('rename keeps the other metadata keys', async () => {
    fetchMock.mockResolvedValueOnce(Response.json({ id: 's1', metadata: { title: 'Old', pinned: '1' } }))
    fetchMock.mockResolvedValueOnce(Response.json({ id: 's1' }))
    await api.renameSession('s1', 'New')
    expect(lastCall()).toMatchObject({ url: '/api/agentry/agents/sessions/s1', method: 'POST', body: { metadata: { title: 'New', pinned: '1' } } })
  })

  it('items follows has_more pages', async () => {
    fetchMock.mockResolvedValueOnce(Response.json({ object: 'list', data: [{ id: 'i1' }], first_id: 'i1', last_id: 'i1', has_more: true }))
    fetchMock.mockResolvedValueOnce(Response.json({ object: 'list', data: [{ id: 'i2' }], first_id: 'i2', last_id: 'i2', has_more: false }))
    const items = await api.items('s1')
    expect(items.map((i) => i.id)).toEqual(['i1', 'i2'])
    expect(String(fetchMock.mock.calls[1][0])).toBe('/api/agentry/agents/sessions/s1/items?limit=100&after=i1')
  })

  it('throws ApiError with the Agentry error code and message', async () => {
    fetchMock.mockResolvedValue(Response.json({ error: { type: 'server_error', message: 'agents store unavailable', code: 'store_unavailable' } }, { status: 503 }))
    const error = await api.sendMessage('s1', 'hi').catch((e: unknown) => e)
    expect(error).toBeInstanceOf(ApiError)
    expect(error).toMatchObject({ status: 503, code: 'store_unavailable', message: 'agents store unavailable' })
    expect(isSignedOut(error)).toBe(false)
  })

  it('maps the BFF signed_out answer to a 401 ApiError', async () => {
    fetchMock.mockResolvedValue(Response.json({ error: 'signed_out' }, { status: 401 }))
    const error = await api.models().catch((e: unknown) => e)
    expect(error).toMatchObject({ status: 401, code: 'signed_out' })
    expect(isSignedOut(error)).toBe(true)
    expect(lastCall().url).toBe('/api/models')
  })

  it('a network failure is an ApiError with status 0', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'))
    await expect(api.cancel('s1')).rejects.toMatchObject({ status: 0, code: 'network_error' })
  })

  it('logout returns redirectTo, and /login when the session is already gone', async () => {
    fetchMock.mockResolvedValueOnce(Response.json({ redirectTo: 'https://kc.test/logout?id_token_hint=x' }))
    expect(await api.logout()).toBe('https://kc.test/logout?id_token_hint=x')
    expect(lastCall()).toMatchObject({ url: '/api/auth/logout', method: 'POST' })
    expect(lastCall().headers.get('x-agentry-csrf')).toBe(CSRF)

    fetchMock.mockResolvedValueOnce(Response.json({ error: 'forbidden' }, { status: 403 }))
    expect(await api.logout()).toBe('/login')
    fetchMock.mockResolvedValueOnce(Response.json({ error: 'signed_out' }, { status: 401 }))
    expect(await api.logout()).toBe('/login')
  })

  it('titleFrom truncates long first messages', () => {
    expect(titleFrom('x'.repeat(100))).toHaveLength(80)
    expect(titleFrom('x'.repeat(100)).endsWith('…')).toBe(true)
  })
})
