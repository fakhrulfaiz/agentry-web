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

const proxy = await import('../../app/api/agentry/[...path]/route')
const stream = await import('../../app/api/agentry/sessions/[id]/stream/route')
const { getSession, SESSION_COOKIE } = await import('@/server/session')

const KEY = 'sk-upstream-key'
const CSRF = 'csrf-token-value'
const BASE = 'http://web.test/api/agentry'
const fetchMock = vi.fn<typeof fetch>()

async function signIn() {
  const session = await getSession()
  session.credential = { kind: 'apikey', key: KEY }
  session.identity = { owner: '', roles: [], displayName: 'API key user' }
  session.csrf = CSRF
  await session.save()
  mockState.store = mockState.store.next()
}

function ctx<T>(params: T) {
  return { params: Promise.resolve(params) }
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

describe('proxy /api/agentry/[...path]', () => {
  it('forwards an allow-listed GET with Agentry auth and without browser credentials', async () => {
    fetchMock.mockResolvedValue(Response.json({ object: 'list', data: [{ id: 's1' }] }, { status: 200 }))
    const res = await call('GET', '/agents/sessions?limit=20&after=s0', {
      headers: { cookie: 'agentry_session=abc; other=1', authorization: 'Bearer browser' },
    })

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ object: 'list', data: [{ id: 's1' }] })
    const [url, init] = fetchMock.mock.calls[0]
    expect(String(url)).toBe('http://agentry.test/v1/agents/sessions?limit=20&after=s0')
    const headers = new Headers(init?.headers)
    expect(headers.get('authorization')).toBe(`Bearer ${KEY}`)
    expect(headers.get('openai-beta')).toBe('agents=v1')
    expect(headers.get('cookie')).toBeNull()
    expect(init?.method).toBe('GET')
  })

  it('forwards a POST body with a valid CSRF token and passes the upstream status through', async () => {
    fetchMock.mockResolvedValue(Response.json({ error: { type: 'invalid_request_error' } }, { status: 400 }))
    const body = JSON.stringify({ events: [{ type: 'user.message', content: [] }] })
    const res = await call('POST', '/agents/sessions/s_1/events', {
      csrf: CSRF,
      headers: { 'content-type': 'application/json' },
      body,
    })

    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: { type: 'invalid_request_error' } })
    const [url, init] = fetchMock.mock.calls[0]
    expect(String(url)).toBe('http://agentry.test/v1/agents/sessions/s_1/events')
    expect(init?.method).toBe('POST')
    expect(new TextDecoder().decode(init?.body as ArrayBuffer)).toBe(body)
    expect(new Headers(init?.headers).get('content-type')).toBe('application/json')
  })

  it('POST without CSRF → 403', async () => {
    const res = await call('POST', '/agents/sessions', { body: '{}' })
    expect(res.status).toBe(403)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('DELETE from another origin → 403', async () => {
    const res = await call('DELETE', '/agents/sessions/s_1', { csrf: CSRF, headers: { origin: 'http://evil.test' } })
    expect(res.status).toBe(403)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('rejects traversal and non-allow-listed paths', async () => {
    for (const [method, path] of [
      ['GET', '/agents/environments'],
      ['GET', '/admin/v1/sessions'],
      ['GET', '/agents/sessions/a%2Fb'],
      ['GET', '/agents/sessions/s_1/events'],
      ['PUT', '/agents/sessions/s_1'],
      ['PATCH', '/agents/sessions/s_1'],
      ['POST', '/agents'],
    ]) {
      const res = await call(method, path, { csrf: CSRF })
      expect(res.status, `${method} ${path}`).toBe(404)
    }
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('answers 401 signed_out without a session', async () => {
    mockState.store = new FakeCookieStore()
    const res = await call('GET', '/agents')
    expect(res.status).toBe(401)
    expect(await res.json()).toEqual({ error: 'signed_out' })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('upstream 401 clears session', async () => {
    fetchMock.mockResolvedValue(Response.json({ error: 'unauthorized' }, { status: 401 }))
    const res = await call('GET', '/agents')

    expect(res.status).toBe(401)
    expect(await res.json()).toEqual({ error: 'signed_out' })
    expect(mockState.store.get(SESSION_COOKIE)).toBeUndefined()
    mockState.store = mockState.store.next()
    expect((await getSession()).credential).toBeUndefined()
  })

  it('answers 502 when Agentry is unreachable', async () => {
    fetchMock.mockRejectedValue(new TypeError('fetch failed'))
    const res = await call('GET', '/agents')
    expect(res.status).toBe(502)
  })
})

describe('stream /api/agentry/sessions/[id]/stream', () => {
  function sse(chunks: string[]) {
    const encoder = new TextEncoder()
    return new ReadableStream<Uint8Array>({
      start(controller) {
        for (const chunk of chunks) controller.enqueue(encoder.encode(chunk))
        controller.close()
      },
    })
  }

  it('forwards Last-Event-ID and pipes bytes unchanged', async () => {
    const chunks = ['id: 5\nevent: message\ndata: {"type":"agent.session.idle"}\n\n', 'id: 6\ndata: {"a":', '1}\n\n', ': keepalive\n\n']
    fetchMock.mockResolvedValue(new Response(sse(chunks), { status: 200, headers: { 'content-type': 'text/event-stream' } }))
    const controller = new AbortController()
    const req = sameOriginRequest(`${BASE}/sessions/s_1/stream`, {
      headers: { 'last-event-id': '4', cookie: 'agentry_session=x' },
      signal: controller.signal,
    })
    const res = await stream.GET(req as never, ctx({ id: 's_1' }))

    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('text/event-stream')
    expect(res.headers.get('cache-control')).toContain('no-store')
    expect(await res.text()).toBe(chunks.join(''))

    const [url, init] = fetchMock.mock.calls[0]
    expect(String(url)).toBe('http://agentry.test/v1/agents/sessions/s_1/events?stream=true')
    const headers = new Headers(init?.headers)
    expect(headers.get('last-event-id')).toBe('4')
    expect(headers.get('authorization')).toBe(`Bearer ${KEY}`)
    expect(headers.get('openai-beta')).toBe('agents=v1')
    expect(headers.get('accept')).toBe('text/event-stream')
    expect(headers.get('cookie')).toBeNull()

    expect(init?.signal?.aborted).toBe(false)
    controller.abort()
    expect(init?.signal?.aborted).toBe(true)
  })

  it('streams chunks as they arrive (no buffering)', async () => {
    let push!: (s: string) => void
    const upstream = new ReadableStream<Uint8Array>({
      start(c) {
        push = (s) => c.enqueue(new TextEncoder().encode(s))
      },
    })
    fetchMock.mockResolvedValue(new Response(upstream, { status: 200, headers: { 'content-type': 'text/event-stream' } }))
    const res = await stream.GET(sameOriginRequest(`${BASE}/sessions/s_1/stream`) as never, ctx({ id: 's_1' }))
    const reader = res.body!.getReader()
    push('id: 1\ndata: {}\n\n')
    const first = await reader.read()
    expect(new TextDecoder().decode(first.value)).toBe('id: 1\ndata: {}\n\n')
    await reader.cancel()
  })

  it('omits Last-Event-ID when the client sent none', async () => {
    fetchMock.mockResolvedValue(new Response(sse([]), { status: 200 }))
    await stream.GET(sameOriginRequest(`${BASE}/sessions/s_1/stream`) as never, ctx({ id: 's_1' }))
    expect(new Headers(fetchMock.mock.calls[0][1]?.headers).has('last-event-id')).toBe(false)
  })

  it('rejects a malformed session id', async () => {
    const res = await stream.GET(sameOriginRequest(`${BASE}/sessions/x/stream`) as never, ctx({ id: '../admin' }))
    expect(res.status).toBe(404)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('upstream 401 clears session', async () => {
    fetchMock.mockResolvedValue(Response.json({ error: 'unauthorized' }, { status: 401 }))
    const res = await stream.GET(sameOriginRequest(`${BASE}/sessions/s_1/stream`) as never, ctx({ id: 's_1' }))
    expect(res.status).toBe(401)
    expect(await res.json()).toEqual({ error: 'signed_out' })
    expect(mockState.store.get(SESSION_COOKIE)).toBeUndefined()
  })

  it('passes a non-OK upstream status through', async () => {
    fetchMock.mockResolvedValue(Response.json({ error: { type: 'not_found_error' } }, { status: 404 }))
    const res = await stream.GET(sameOriginRequest(`${BASE}/sessions/s_9/stream`) as never, ctx({ id: 's_9' }))
    expect(res.status).toBe(404)
    expect(await res.json()).toEqual({ error: { type: 'not_found_error' } })
  })
})
