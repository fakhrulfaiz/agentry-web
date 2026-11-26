// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { OAIAgentSession, OAIRequiredAction, OAISessionEvent, OAISubagent, OAITurn } from '@/api/types'
import { useConversation } from '@/chat/use-conversation'
import approvalTurn from '../fixtures/approval-turn.json'
import delegation from '../fixtures/live/subagent.json'
import twoTurns from '../fixtures/two-turns.json'

interface Frame {
  id?: string
  event: OAISessionEvent
}

const APPROVAL = approvalTurn as unknown as { frames: Frame[]; items: unknown[] }
const FRAMES = APPROVAL.frames
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

/** An open stream that starts with `initial`; `push` delivers more frames. */
function pushableStream(initial: Frame[]): { response: () => Response; push(frames: Frame[]): void } {
  let controller!: ReadableStreamDefaultController<Uint8Array>
  const body = new ReadableStream<Uint8Array>({
    start(c) {
      controller = c
      c.enqueue(encoder.encode(sse(initial)))
    },
  })
  return {
    response: () => new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } }),
    push: (frames) => controller.enqueue(encoder.encode(sse(frames))),
  }
}

function sessionResource(status: OAIAgentSession['status'], required_actions: OAIRequiredAction[] = []): OAIAgentSession {
  const created = FRAMES[0].event as Extract<OAISessionEvent, { session: OAIAgentSession }>
  return { ...created.session, status, required_actions }
}

let streams: Array<() => Response>
let session: OAIAgentSession
/** How the `GET /agents/sessions/{id}` call answers; by default at once with `session`. */
let sessionResponse: () => Response | Promise<Response>
let itemsResponse: () => Response | Promise<Response>
/** `GET .../subagents` and `GET .../subagents/{id}/turns`; 404 by default. */
let subagentsResponse: (() => Response) | null
let subagentTurnsResponse: (() => Response) | null
const fetchMock = vi.fn<typeof fetch>()

const itemsCalls = () => fetchMock.mock.calls.filter(([url]) => String(url).startsWith(`/api/agentry/agents/sessions/${SID}/items`))
const itemsList = (data: unknown[]) => Response.json({ object: 'list', data, first_id: null, last_id: null, has_more: false })
const streamCalls = () => fetchMock.mock.calls.filter(([url]) => String(url).endsWith(`/sessions/${SID}/stream`))
const lastEventIds = () => streamCalls().map(([, init]) => new Headers(init?.headers).get('last-event-id'))
const flush = () => act(async () => { await vi.advanceTimersByTimeAsync(0) })
const advance = (ms: number) => act(async () => { await vi.advanceTimersByTimeAsync(ms) })

beforeEach(() => {
  vi.useFakeTimers()
  document.head.innerHTML = `<meta name="agentry-csrf" content="${CSRF}">`
  streams = []
  session = sessionResource('idle')
  sessionResponse = () => Response.json(session)
  itemsResponse = () => itemsList([])
  subagentsResponse = null
  subagentTurnsResponse = null
  fetchMock.mockReset()
  fetchMock.mockImplementation(async (input, init) => {
    const url = String(input)
    if (url.startsWith(`/api/agentry/agents/sessions/${SID}/items`)) return itemsResponse()
    if (url === `/api/agentry/agents/sessions/${SID}/subagents` && subagentsResponse) return subagentsResponse()
    if (/\/subagents\/[^/]+\/turns$/.test(url) && subagentTurnsResponse) return subagentTurnsResponse()
    if (url.endsWith('/stream')) return (streams.shift() ?? (() => streamResponse('', true)))()
    if (url === `/api/agentry/agents/sessions/${SID}` && (init?.method ?? 'GET') === 'GET') return sessionResponse()
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
    const replay = FRAMES.filter((f) => f.id !== undefined).slice(0, 4) // the turn has started
    itemsResponse = () => itemsList(APPROVAL.items.slice(0, 2)) // the user message and the pending call
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

  it('requests the session snapshot together with the items, not after them', async () => {
    let answerItems!: () => void
    itemsResponse = () => new Promise<Response>((resolve) => (answerItems = () => resolve(itemsList(APPROVAL.items.slice(0, 1)))))
    const { unmount } = renderHook(() => useConversation(SID))
    await flush()
    const sessionReads = () => fetchMock.mock.calls.filter(([url, init]) => String(url) === `/api/agentry/agents/sessions/${SID}` && (init?.method ?? 'GET') === 'GET')
    expect(sessionReads()).toHaveLength(1)
    answerItems()
    await flush()
    expect(sessionReads()).toHaveLength(1)
    expect(streamCalls()).toHaveLength(1)
    unmount()
  })

  it('opened again, shows the last history and idle status at once while it reloads', async () => {
    itemsResponse = () => itemsList(APPROVAL.items.slice(0, 1))
    const first = renderHook(() => useConversation(SID))
    await flush()
    expect(first.result.current.state.items.map((v) => v.kind)).toEqual(['user'])
    first.unmount()

    itemsResponse = () => new Promise<Response>(() => {}) // the reload never answers
    const again = renderHook(() => useConversation(SID))
    expect(again.result.current.loaded).toBe(true)
    expect(again.result.current.ready).toBe(true)
    expect(again.result.current.state.items.map((v) => v.kind)).toEqual(['user'])
    again.unmount()
  })

  it('opened again while a turn was running, waits for a fresh status (no stale approval)', async () => {
    itemsResponse = () => itemsList(APPROVAL.items.slice(0, 1))
    session = sessionResource('requires_action', [{ type: 'approval', id: 'appr_1', kind: 'tool_approval', prompt: 'Approve', options: ['approve', 'deny'] }])
    const first = renderHook(() => useConversation(SID))
    await flush()
    first.unmount()

    itemsResponse = () => new Promise<Response>(() => {})
    const again = renderHook(() => useConversation(SID))
    expect(again.result.current.loaded).toBe(true)
    expect(again.result.current.ready).toBe(false)
    expect(again.result.current.state.items.some((v) => v.kind === 'action')).toBe(false)
    again.unmount()
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

  it('send carries a model / effort change on the message event', async () => {
    streams.push(() => streamResponse('', true))
    const { result, unmount } = renderHook(() => useConversation(SID))
    await flush()
    await act(async () => {
      await result.current.send('think harder', { effort: 'high' })
    })
    const post = fetchMock.mock.calls.find(([url, init]) => String(url).endsWith('/events') && init?.method === 'POST')
    expect(JSON.parse(String(post![1]?.body))).toEqual({
      events: [
        {
          type: 'agent.session.input.message',
          input: [{ role: 'user', content: [{ type: 'input_text', text: 'think harder' }] }],
          reasoning: { effort: 'high' },
        },
      ],
    })
    unmount()
  })

  it('a 409 session_setting_not_live drops the optimistic message and rethrows the backend message', async () => {
    streams.push(() => streamResponse('', true))
    const { result, unmount } = renderHook(() => useConversation(SID))
    await flush()
    fetchMock.mockImplementationOnce(async () =>
      Response.json({ error: { message: 'model "nope" is not available', code: 'session_setting_not_live' } }, { status: 409 }),
    )
    await act(async () => {
      await expect(result.current.send('hi', { model: 'nope' })).rejects.toMatchObject({
        status: 409,
        code: 'session_setting_not_live',
        message: 'model "nope" is not available',
      })
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

  it('a 403 or 404 on the stream closes it with a reason instead of retrying', async () => {
    for (const [status, reason] of [[403, 'forbidden'], [404, 'not_found']] as const) {
      fetchMock.mockClear()
      streams = [() => Response.json({ error: 'nope' }, { status })]
      const { result, unmount } = renderHook(() => useConversation(SID))
      await flush()
      expect(result.current.connection).toBe('closed')
      expect(result.current.closedReason).toBe(reason)
      await advance(60_000)
      expect(streamCalls()).toHaveLength(1)
      unmount()
    }
  })

  it('applies the snapshot before opening the stream', async () => {
    const approval: OAIRequiredAction = { type: 'approval', id: 'appr_1', kind: 'tool_approval', prompt: 'Approve', options: ['approve', 'deny'] }
    session = sessionResource('requires_action', [approval])
    sessionResponse = () => new Promise((resolve) => setTimeout(() => resolve(Response.json(session)), 1_000))
    streams.push(() => streamResponse('', true))

    const { result, unmount } = renderHook(() => useConversation(SID))
    await flush()
    expect(streamCalls()).toHaveLength(0)
    await advance(1_000)
    expect(streamCalls()).toHaveLength(1)
    expect(result.current.state.items.map((v) => v.kind)).toEqual(['action'])
    unmount()
  })

  it('ignores a slow snapshot once newer stream events have arrived', async () => {
    const approval: OAIRequiredAction = { type: 'approval', id: 'appr_1', kind: 'tool_approval', prompt: 'Approve', options: ['approve', 'deny'] }
    // The snapshot was taken while the approval was pending, but answers only after 8s.
    const stale = sessionResource('requires_action', [approval])
    sessionResponse = () => new Promise((resolve) => setTimeout(() => resolve(Response.json(stale)), 8_000))
    // Meanwhile the stream (opened after the 5s wait) reports the approval resolved and the session idle.
    const resolved: Frame = { event: { type: 'agent.session.idle', event_id: 'e_live', session: sessionResource('idle') } as OAISessionEvent }
    streams.push(() => streamResponse(sse([resolved]), true))

    const { result, unmount } = renderHook(() => useConversation(SID))
    await flush()
    await advance(5_000)
    expect(streamCalls()).toHaveLength(1)
    expect(result.current.state.status).toBe('idle')
    await advance(3_000)
    expect(result.current.state.status).toBe('idle')
    expect(result.current.state.items.filter((v) => v.kind === 'action')).toEqual([])
    unmount()
  })

  it('resets the backoff after a connection that stayed up 30s without events', async () => {
    streams.push(() => streamResponse(''))
    streams.push(() => streamResponse(''))
    // Opens fine, carries no events, and drops after 30s.
    streams.push(() => {
      const body = new ReadableStream<Uint8Array>({ start: (c) => void setTimeout(() => c.close(), 30_000) })
      return new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } })
    })
    streams.push(() => streamResponse(''))

    const { unmount } = renderHook(() => useConversation(SID))
    await flush()
    await advance(1_000)
    await advance(2_000)
    expect(streamCalls()).toHaveLength(3)
    await advance(30_000)
    // Without the reset this would wait 4s.
    await advance(999)
    expect(streamCalls()).toHaveLength(3)
    await advance(1)
    expect(streamCalls()).toHaveLength(4)
    unmount()
  })

  it('loads the turn records with the items, for the trace', async () => {
    const turn = delegation.turns[0] as OAITurn
    const base = fetchMock.getMockImplementation()!
    fetchMock.mockImplementation(async (input, init) =>
      String(input).startsWith(`/api/agentry/agents/sessions/${SID}/turns`)
        ? Response.json({ object: 'list', data: [turn], first_id: turn.id, last_id: turn.id, has_more: false })
        : base(input, init),
    )
    streams.push(() => streamResponse('', true))
    const { result, unmount } = renderHook(() => useConversation(SID))
    await flush()
    expect(result.current.state.turns).toEqual([turn])
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

  describe('history before replay (R14)', () => {
    // Shaped like the backend before 2026-11-26: the stream has assistant messages only, `items` has the rest.
    const TWO = twoTurns as unknown as { historyThrough: number; frames: Frame[]; items: unknown[] }
    const TURN1_ITEMS = TWO.items.slice(0, 3)

    it('fetches items before opening the stream', async () => {
      let release!: () => void
      itemsResponse = () => new Promise<Response>((resolve) => { release = () => resolve(itemsList([])) })
      streams.push(() => streamResponse('', true))
      const { unmount } = renderHook(() => useConversation(SID))
      await flush()
      expect(itemsCalls()).toHaveLength(1)
      expect(String(itemsCalls()[0][0])).toBe(`/api/agentry/agents/sessions/${SID}/items?limit=100`)
      expect(streamCalls()).toHaveLength(0)
      await act(async () => {
        release()
        await vi.advanceTimersByTimeAsync(0)
      })
      expect(streamCalls()).toHaveLength(1)
      expect(lastEventIds()).toEqual(['0'])
      unmount()
    })

    it('a replay covering an item already loaded gives exactly one bubble', async () => {
      const turn1 = TWO.frames.slice(0, TWO.historyThrough)
      itemsResponse = () => itemsList(TURN1_ITEMS)
      streams.push(() => streamResponse(sse(turn1), true))
      const { result, unmount } = renderHook(() => useConversation(SID))
      await flush()
      expect(result.current.state.items).toEqual([
        { kind: 'user', id: 'item_msg_3', text: 'Say hello' },
        { kind: 'reasoning', id: 'item_reason_4', text: 'The user wants a greeting.', streaming: false },
        { kind: 'assistant', id: 'item_msg_4', text: 'Hello, world!', streaming: false },
      ])
      unmount()
    })

    it('a reopened chat shows user, tool and assistant items when the stream carries only assistant frames', async () => {
      itemsResponse = () => itemsList(TWO.items)
      streams.push(() => streamResponse(sse(TWO.frames), true))
      const { result, unmount } = renderHook(() => useConversation(SID))
      await flush()
      expect(result.current.state.items).toEqual([
        { kind: 'user', id: 'item_msg_3', text: 'Say hello' },
        { kind: 'reasoning', id: 'item_reason_4', text: 'The user wants a greeting.', streaming: false },
        { kind: 'assistant', id: 'item_msg_4', text: 'Hello, world!', streaming: false },
        { kind: 'user', id: 'item_msg_7', text: 'Search the docs' },
        { kind: 'tool', id: 'item_fn_8', callId: 'call_1', name: 'search', args: { query: 'docs' }, status: 'done', output: '3 results' },
        { kind: 'assistant', id: 'item_msg_10', text: 'Found 3 results.', streaming: false },
      ])
      expect(result.current.state.lastEventId).toBe(TWO.frames.at(-1)?.id)
      unmount()
    })

    it('reconnects resume from the last id without reloading items, and re-read the subagents', async () => {
      itemsResponse = () => itemsList(TWO.items)
      streams.push(() => streamResponse(sse(TWO.frames)))
      const subagentReads = () => fetchMock.mock.calls.filter(([url]) => String(url) === `/api/agentry/agents/sessions/${SID}/subagents`)
      const { result, unmount } = renderHook(() => useConversation(SID))
      await flush()
      expect(itemsCalls()).toHaveLength(1)
      expect(subagentReads()).toHaveLength(1)
      await advance(1_000)
      expect(streamCalls()).toHaveLength(2)
      expect(lastEventIds()).toEqual(['0', TWO.frames.at(-1)?.id])
      // Subagent events are never replayed, so a reconnect reads the subagents again; the items it does not.
      expect(subagentReads()).toHaveLength(2)
      await advance(5_000)
      expect(itemsCalls()).toHaveLength(1)
      expect(result.current.state.items.filter((v) => v.kind === 'assistant')).toHaveLength(2)
      unmount()
    })

    it('shows streamed item frames live and never polls the items while a turn runs', async () => {
      session = sessionResource('in_progress')
      itemsResponse = () => itemsList(TURN1_ITEMS)
      const live = pushableStream(TWO.frames.slice(0, TWO.historyThrough + 3)) // turn 2 has started
      streams.push(live.response)
      const { result, unmount } = renderHook(() => useConversation(SID))
      await flush()
      const user = { id: 'item_msg_7', type: 'message', role: 'user', content: [{ type: 'input_text', text: 'Search the docs' }], status: 'completed', turn_id: 'turn_6' }
      const call = { id: 'item_fn_8', type: 'function_call', call_id: 'call_1', name: 'search', arguments: '{"query":"docs"}', status: 'in_progress', turn_id: 'turn_6' }
      const last = TWO.frames[TWO.historyThrough + 2].id
      await act(async () => {
        live.push([
          { id: `${last}.1`, event: { type: 'agent.session.turn.item.done', event_id: 'a', session_id: SID, turn_id: 'turn_6', item: user } as OAISessionEvent },
          { id: `${last}.2`, event: { type: 'agent.session.turn.item.added', event_id: 'b', session_id: SID, turn_id: 'turn_6', item: call } as OAISessionEvent },
        ])
        await vi.advanceTimersByTimeAsync(0)
      })
      expect(result.current.state.items.slice(-2)).toEqual([
        { kind: 'user', id: 'item_msg_7', text: 'Search the docs' },
        { kind: 'tool', id: 'item_fn_8', callId: 'call_1', name: 'search', args: { query: 'docs' }, status: 'running' },
      ])
      expect(result.current.state.lastEventId).toBe(`${last}.2`)
      await advance(30_000)
      expect(itemsCalls()).toHaveLength(1)
      unmount()
    })

    it('shows subagents with the history and follows their live events', async () => {
      const child = (delegation as unknown as { items: unknown[]; subagents: Array<{ subagent: OAISubagent; turns: OAITurn[] }> })
      const { subagent, turns } = child.subagents[0]
      itemsResponse = () => itemsList(child.items)
      const running = { ...subagent, status: 'active' as const, closed_at: undefined }
      subagentsResponse = () => itemsList([running])
      subagentTurnsResponse = () => itemsList([{ ...turns[0], status: 'in_progress', completed_at: null }])
      const live = pushableStream([])
      streams.push(live.response)
      const { result, unmount } = renderHook(() => useConversation(SID))
      await flush()
      const card = () => result.current.state.items.find((v) => v.kind === 'subagent')
      expect(card()).toMatchObject({ subagentId: subagent.id, name: 'List workspace files and count', status: 'in_progress' })
      const calls = fetchMock.mock.calls.length
      await act(async () => {
        live.push([
          { event: { type: 'agent.session.subagent.updated', event_id: 'u', session_id: SID, subagent: running, turn: turns[0] } as OAISessionEvent },
          { event: { type: 'agent.session.subagent.closed', event_id: 'c', session_id: SID, subagent } as OAISessionEvent },
        ])
        await vi.advanceTimersByTimeAsync(0)
      })
      expect(card()).toMatchObject({ status: 'completed', endedAt: turns[0].completed_at })
      // Live events, no polling.
      await advance(30_000)
      expect(fetchMock.mock.calls.length).toBe(calls)
      unmount()
    })

    it('reads subagents one at a time, even when a reconnect asks again during the first read', async () => {
      const child = (delegation as unknown as { items: unknown[]; subagents: Array<{ subagent: OAISubagent; turns: OAITurn[] }> })
      const { subagent, turns } = child.subagents[0]
      itemsResponse = () => itemsList(child.items)
      subagentTurnsResponse = () => itemsList(turns)
      let inFlight = 0
      let most = 0
      const base = fetchMock.getMockImplementation()!
      fetchMock.mockImplementation(async (input, init) => {
        if (String(input) !== `/api/agentry/agents/sessions/${SID}/subagents`) return base(input, init)
        inFlight += 1
        most = Math.max(most, inFlight)
        await new Promise((resolve) => setTimeout(resolve, 2_000))
        inFlight -= 1
        return itemsList([subagent])
      })
      // The stream ends at once, so the reconnect after 1s asks for subagents while the first read is slow.
      streams.push(() => streamResponse(''))
      const { unmount } = renderHook(() => useConversation(SID))
      await flush()
      await advance(6_000)
      const reads = fetchMock.mock.calls.filter(([url]) => String(url) === `/api/agentry/agents/sessions/${SID}/subagents`)
      expect(reads.length).toBeGreaterThanOrEqual(2)
      expect(most).toBe(1)
      unmount()
    })

    it('opening a chat reads the items once', async () => {
      const turnRecords = TWO.frames.flatMap((f) => (f.event.type === 'agent.session.turn.completed' ? [f.event.turn] : []))
      const base = fetchMock.getMockImplementation()!
      fetchMock.mockImplementation(async (input, init) =>
        String(input).startsWith(`/api/agentry/agents/sessions/${SID}/turns`) ? itemsList(turnRecords) : base(input, init),
      )
      itemsResponse = () => itemsList(TWO.items)
      streams.push(() => streamResponse(sse(TWO.frames), true))
      const { result, unmount } = renderHook(() => useConversation(SID))
      expect(result.current.loaded).toBe(false)
      await flush()
      expect(result.current.loaded).toBe(true)
      await advance(5_000)
      expect(itemsCalls()).toHaveLength(1)
      unmount()
    })

    it('a 401 while loading items signs out without opening the stream', async () => {
      itemsResponse = () => Response.json({ error: 'signed_out' }, { status: 401 })
      const onSignedOut = vi.fn()
      const { result, unmount } = renderHook(() => useConversation(SID, { onSignedOut }))
      await flush()
      expect(onSignedOut).toHaveBeenCalled()
      expect(result.current.connection).toBe('closed')
      expect(streamCalls()).toHaveLength(0)
      unmount()
    })
  })
})

describe('useConversation first message', () => {
  it('shows the message sent from the new-chat page before the history loads', async () => {
    const { setPendingFirst } = await import('@/chat/pending-first')
    setPendingFirst(SID, { text: 'hello there' })
    const { result, unmount } = renderHook(() => useConversation(SID))
    expect(result.current.state.items.map((v) => v.kind)).toEqual(['user'])
    await flush()
    expect(result.current.state.items.some((v) => v.kind === 'user')).toBe(true)
    unmount()
  })
})
