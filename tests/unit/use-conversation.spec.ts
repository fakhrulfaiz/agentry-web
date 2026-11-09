// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { OAIAgentSession, OAIRequiredAction, OAISessionEvent } from '@/api/types'
import { useConversation } from '@/chat/use-conversation'
import approvalTurn from '../fixtures/approval-turn.json'

interface Frame {
  id?: string
  event: OAISessionEvent
}

const FRAMES = (approvalTurn as unknown as { frames: Frame[] }).frames
const SID = 'sess_fixture'
const CSRF = 'csrf-from-meta'
const encoder = new TextEncoder()

function sse(frames: Frame[]): string {
  return frames.map((f) => `${f.id === undefined ? '' : `id: ${f.id}\n`}data: ${JSON.stringify(f.event)}\n\n`).join('')
}

/** A stream response; it closes after the text unless `open`. */
function streamResponse(text: string, open = false): Response {
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      if (text) controller.enqueue(encoder.encode(text))
      if (!open) controller.close()
    },
  })
  return new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } })
}

function sessionResource(status: OAIAgentSession['status'], required_actions: OAIRequiredAction[] = []): OAIAgentSession {
  const created = FRAMES[0].event as Extract<OAISessionEvent, { session: OAIAgentSession }>
  return { ...created.session, status, required_actions }
}

let streams: Array<() => Response>
let session: OAIAgentSession
const fetchMock = vi.fn<typeof fetch>()

const streamCalls = () => fetchMock.mock.calls.filter(([url]) => String(url).endsWith(`/sessions/${SID}/stream`))
const lastEventIds = () => streamCalls().map(([, init]) => new Headers(init?.headers).get('last-event-id'))
const flush = () => act(async () => { await vi.advanceTimersByTimeAsync(0) })
const advance = (ms: number) => act(async () => { await vi.advanceTimersByTimeAsync(ms) })

beforeEach(() => {
  vi.useFakeTimers()
  document.head.innerHTML = `<meta name="agentry-csrf" content="${CSRF}">`
  streams = []
  session = sessionResource('idle')
  fetchMock.mockReset()
  fetchMock.mockImplementation(async (input, init) => {
    const url = String(input)
    if (url.endsWith('/stream')) return (streams.shift() ?? (() => streamResponse('', true)))()
    if (url === `/api/agentry/agents/sessions/${SID}` && (init?.method ?? 'GET') === 'GET') return Response.json(session)
    if (url === `/api/agentry/agents/sessions/${SID}/events`) return Response.json({})
    return Response.json({ error: 'not_found' }, { status: 404 })
  })
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('useConversation', () => {
  it('replays the stream from Last-Event-ID 0 and applies the session snapshot', async () => {
    const replay = FRAMES.filter((f) => f.id !== undefined).slice(0, 7) // through the function_call item
    const approval: OAIRequiredAction = { type: 'approval', id: 'appr_1', kind: 'tool_approval', prompt: 'Approve bash_rm', options: ['approve', 'deny'] }
    session = sessionResource('requires_action', [approval])
    streams.push(() => streamResponse(sse(replay), true))

    const { result, unmount } = renderHook(() => useConversation(SID))
    await flush()

    expect(lastEventIds()).toEqual(['0'])
    expect(String(streamCalls()[0][0])).toBe(`/api/agentry/sessions/${SID}/stream`)
    expect(result.current.connection).toBe('live')
    expect(result.current.state.lastEventId).toBe(replay.at(-1)?.id)
    expect(result.current.state.items.map((v) => v.kind)).toEqual(['user', 'tool', 'action'])
    expect(result.current.state.status).toBe('requires_action')
    unmount()
  })

  it('reconnects after 1s, then 2s, doubling to a 30s cap, resending the last id', async () => {
    const first = FRAMES.filter((f) => f.id !== undefined).slice(0, 3)
    streams.push(() => streamResponse(sse(first)))
    for (let i = 0; i < 7; i++) streams.push(() => streamResponse(''))

    const { result, unmount } = renderHook(() => useConversation(SID))
    await flush()
    expect(streamCalls()).toHaveLength(1)
    expect(result.current.connection).toBe('reconnecting')

    const waits = [1_000, 2_000, 4_000, 8_000, 16_000, 30_000, 30_000]
    for (const [i, wait] of waits.entries()) {
      await advance(wait - 1)
      expect(streamCalls()).toHaveLength(i + 1)
      await advance(1)
      expect(streamCalls()).toHaveLength(i + 2)
    }
    expect(new Set(lastEventIds().slice(1))).toEqual(new Set(['3']))
    unmount()
  })

  it('resets the backoff after a connection that delivered events', async () => {
    const all = FRAMES.filter((f) => f.id !== undefined)
    streams.push(() => streamResponse(''))
    streams.push(() => streamResponse(''))
    streams.push(() => streamResponse(sse(all.slice(0, 4))))

    const { unmount } = renderHook(() => useConversation(SID))
    await flush()
    await advance(1_000)
    await advance(2_000)
    expect(streamCalls()).toHaveLength(3)
    await advance(1_000)
    expect(streamCalls()).toHaveLength(4)
    expect(lastEventIds()).toEqual(['0', '0', '0', '4'])
    unmount()
  })

  it('reconnects immediately when the page becomes visible', async () => {
    streams.push(() => streamResponse(sse(FRAMES.slice(0, 2))))
    const { result, unmount } = renderHook(() => useConversation(SID))
    await flush()
    expect(result.current.connection).toBe('reconnecting')
    expect(streamCalls()).toHaveLength(1)

    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true })
    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'))
      await vi.advanceTimersByTimeAsync(0)
    })
    expect(streamCalls()).toHaveLength(2)
    expect(lastEventIds()[1]).toBe('2')
    expect(result.current.connection).toBe('live')
    unmount()
  })

  it('send while running posts a message and keeps status running', async () => {
    const running = FRAMES.filter((f) => f.id !== undefined).slice(0, 4) // created, in_progress, turn.created, turn.in_progress
    session = sessionResource('in_progress')
    streams.push(() => streamResponse(sse(running), true))
    const { result, unmount } = renderHook(() => useConversation(SID))
    await flush()
    expect(result.current.state.status).toBe('in_progress')

    await act(async () => {
      await result.current.send('also check /var')
    })
    const post = fetchMock.mock.calls.find(([url, init]) => String(url).endsWith('/events') && init?.method === 'POST')
    expect(post).toBeDefined()
    const [url, init] = post!
    expect(String(url)).toBe(`/api/agentry/agents/sessions/${SID}/events`)
    expect(new Headers(init?.headers).get('x-agentry-csrf')).toBe(CSRF)
    expect(JSON.parse(String(init?.body))).toEqual({
      events: [{ type: 'agent.session.input.message', input: [{ role: 'user', content: [{ type: 'input_text', text: 'also check /var' }] }] }],
    })
    expect(result.current.state.status).toBe('in_progress')
    expect(result.current.state.items.at(-1)).toMatchObject({ kind: 'user', text: 'also check /var' })
    unmount()
  })

  it('drops the optimistic message when the send fails', async () => {
    streams.push(() => streamResponse('', true))
    const { result, unmount } = renderHook(() => useConversation(SID))
    await flush()
    fetchMock.mockImplementationOnce(async () => Response.json({ error: { message: 'store down', code: 'store_unavailable' } }, { status: 503 }))
    await act(async () => {
      await expect(result.current.send('hi')).rejects.toMatchObject({ status: 503, code: 'store_unavailable' })
    })
    expect(result.current.state.items).toEqual([])
    unmount()
  })

  it('stop and answer post cancel and approval_response events', async () => {
    streams.push(() => streamResponse('', true))
    const { result, unmount } = renderHook(() => useConversation(SID))
    await flush()
    await act(async () => {
      await result.current.stop()
      await result.current.answer('appr_1', { decision: 'answer', payload: { selected: ['Red'] } })
    })
    const bodies = fetchMock.mock.calls
      .filter(([url, init]) => String(url).endsWith('/events') && init?.method === 'POST')
      .map(([, init]) => JSON.parse(String(init?.body)))
    expect(bodies).toEqual([
      { events: [{ type: 'agent.session.input.cancel' }] },
      { events: [{ type: 'agent.session.input.approval_response', id: 'appr_1', decision: 'answer', payload: { selected: ['Red'] } }] },
    ])
    unmount()
  })

  it('a 401 on the stream signs out and stops reconnecting', async () => {
    streams.push(() => Response.json({ error: 'signed_out' }, { status: 401 }))
    const onSignedOut = vi.fn()
    const { result, unmount } = renderHook(() => useConversation(SID, { onSignedOut }))
    await flush()
    expect(onSignedOut).toHaveBeenCalled()
    expect(result.current.connection).toBe('closed')
    await advance(60_000)
    expect(streamCalls()).toHaveLength(1)
    unmount()
  })

  it('stops the stream on unmount', async () => {
    streams.push(() => streamResponse('', true))
    const { unmount } = renderHook(() => useConversation(SID))
    await flush()
    const signal = streamCalls()[0][1]?.signal
    unmount()
    expect(signal?.aborted).toBe(true)
    await advance(60_000)
    expect(streamCalls()).toHaveLength(1)
  })
})
