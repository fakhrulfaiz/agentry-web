import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

const { cachedConnectedToolkits, connectedToolkits, forgetConnectedToolkits, parseConnected, parseRpcBody } = await import('@/server/connector-status')

const fetchMock = vi.fn<typeof fetch>()

function listResult(results: Record<string, unknown>) {
  const text = JSON.stringify({ successful: true, data: { results }, error: null })
  return { jsonrpc: '2.0', id: 2, result: { content: [{ type: 'text', text }], isError: false } }
}
const sse = (message: unknown) => new Response(`: connected\n\nevent: message\ndata: ${JSON.stringify(message)}\n\n`, { headers: { 'content-type': 'text/event-stream' } })
const initOk = () => sse({ jsonrpc: '2.0', id: 1, result: { protocolVersion: '2025-03-26' } })

const gmailActive = listResult({
  gmail: { toolkit: 'gmail', status: 'active', accounts: [{ id: 'a', status: 'active' }] },
  github: { toolkit: 'github', status: 'initiated', accounts: [] },
  slack: { toolkit: 'slack', status: 'active', accounts: [{ id: 'b', status: 'expired' }] },
})

beforeEach(() => {
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
  forgetConnectedToolkits('alice')
})
afterEach(() => vi.unstubAllGlobals())

describe('parseRpcBody', () => {
  it('reads plain JSON and the first SSE data line', () => {
    expect(parseRpcBody('{"a":1}')).toEqual({ a: 1 })
    expect(parseRpcBody(': connected\n\nevent: message\ndata: {"a":2}\n\n')).toEqual({ a: 2 })
  })
  it('throws when there is no message', () => {
    expect(() => parseRpcBody(': connected\n\n')).toThrow()
  })
})

describe('parseConnected', () => {
  it('keeps only toolkits with an active account', () => {
    expect([...parseConnected(gmailActive)]).toEqual(['gmail'])
  })
  it('throws on an unsuccessful or error result', () => {
    expect(() => parseConnected({ error: { code: -1 } })).toThrow()
    expect(() => parseConnected({ result: { isError: true, content: [] } })).toThrow()
    expect(() => parseConnected({ result: { content: [{ text: '{"successful":false}' }] } })).toThrow()
  })
})

describe('connectedToolkits', () => {
  it('initializes, then lists with action "list" only, reading an SSE reply', async () => {
    fetchMock.mockResolvedValueOnce(initOk()).mockResolvedValueOnce(sse(gmailActive))
    const result = await connectedToolkits('ck_test', ['gmail', 'github'])
    expect([...result!]).toEqual(['gmail'])
    const [url, init] = fetchMock.mock.calls[1]
    expect(url).toBe('https://connect.composio.dev/mcp')
    expect((init?.headers as Record<string, string>)['x-consumer-api-key']).toBe('ck_test')
    expect((init?.headers as Record<string, string>).accept).toBe('application/json, text/event-stream')
    const sent = JSON.parse(String(init?.body))
    expect(sent.params.name).toBe('COMPOSIO_MANAGE_CONNECTIONS')
    expect(sent.params.arguments).toEqual({ toolkits: [{ name: 'gmail', action: 'list' }, { name: 'github', action: 'list' }] })
  })

  it('forwards a session id from initialize and accepts a plain JSON reply', async () => {
    fetchMock
      .mockResolvedValueOnce(new Response('{}', { headers: { 'mcp-session-id': 's-1' } }))
      .mockResolvedValueOnce(Response.json(gmailActive))
    expect([...(await connectedToolkits('ck_test', ['gmail']))!]).toEqual(['gmail'])
    expect((fetchMock.mock.calls[1][1]?.headers as Record<string, string>)['mcp-session-id']).toBe('s-1')
  })

  it('returns null on HTTP errors, network errors and bad bodies', async () => {
    fetchMock.mockResolvedValueOnce(new Response('no', { status: 401 }))
    expect(await connectedToolkits('ck_test', ['gmail'])).toBeNull()
    fetchMock.mockRejectedValueOnce(new Error('offline'))
    expect(await connectedToolkits('ck_test', ['gmail'])).toBeNull()
    fetchMock.mockResolvedValueOnce(initOk()).mockResolvedValueOnce(new Response('garbage'))
    expect(await connectedToolkits('ck_test', ['gmail'])).toBeNull()
    fetchMock.mockResolvedValueOnce(initOk()).mockResolvedValueOnce(sse({ jsonrpc: '2.0', id: 2, error: { code: -32000, message: 'x' } }))
    expect(await connectedToolkits('ck_test', ['gmail'])).toBeNull()
  })
})

describe('cachedConnectedToolkits', () => {
  it('caches per owner until forgotten, and does not cache failures', async () => {
    fetchMock.mockRejectedValueOnce(new Error('offline'))
    expect(await cachedConnectedToolkits('alice', 'ck_test', ['gmail'])).toBeNull()
    fetchMock.mockResolvedValueOnce(initOk()).mockResolvedValueOnce(sse(gmailActive))
    expect((await cachedConnectedToolkits('alice', 'ck_test', ['gmail']))?.has('gmail')).toBe(true)
    const calls = fetchMock.mock.calls.length
    expect((await cachedConnectedToolkits('alice', 'ck_test', ['gmail']))?.has('gmail')).toBe(true)
    expect(fetchMock.mock.calls.length).toBe(calls)
    forgetConnectedToolkits('alice')
    fetchMock.mockResolvedValueOnce(initOk()).mockResolvedValueOnce(sse(listResult({})))
    expect((await cachedConnectedToolkits('alice', 'ck_test', ['gmail']))?.size).toBe(0)
  })
})
