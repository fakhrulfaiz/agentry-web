import { describe, expect, it } from 'vitest'
import type { OAIAgentSession, OAIRequiredAction, OAISessionEvent, OAITurn, StoredSessionItem } from '@/api/types'
import {
  applyEvent,
  applyItems,
  appendLocalUserMessage,
  initialState,
  type ConversationState,
  type MessageView,
} from '@/chat/reducer'
import twoTurns from '../fixtures/two-turns.json'
import approvalTurn from '../fixtures/approval-turn.json'

interface Frame {
  id?: string
  event: OAISessionEvent
}

const TWO_TURNS = twoTurns as unknown as { sessionId: string; historyThrough: number; frames: Frame[] }
const APPROVAL = approvalTurn as unknown as { sessionId: string; frames: Frame[] }
const SID = TWO_TURNS.sessionId

function fold(frames: Frame[], s: ConversationState = initialState(SID)): ConversationState {
  return frames.reduce(applyEvent, s)
}

function session(status: OAIAgentSession['status'], required_actions: OAIRequiredAction[] = []): OAIAgentSession {
  const first = TWO_TURNS.frames[0].event as Extract<OAISessionEvent, { session: OAIAgentSession }>
  return { ...first.session, status, required_actions }
}

function turn(status: OAITurn['status'], error: OAITurn['error'] = null): OAITurn {
  return { id: 'turn_9', object: 'agent.session.turn', session_id: SID, agent_id: 'a', status, created_at: 1, error }
}

const kinds = (s: ConversationState) => s.items.map((v) => v.kind)

describe('conversation reducer', () => {
  it('starts empty and idle', () => {
    expect(initialState('s1')).toMatchObject({ sessionId: 's1', status: 'idle', items: [], lastEventId: null })
  })

  it('concatenates text deltas into one streaming assistant message, finalized when the turn completes', () => {
    const frames = TWO_TURNS.frames.slice(0, TWO_TURNS.historyThrough)
    const lastDelta = frames.findLastIndex((f) => f.event.type === 'agent.session.turn.output_text.delta')
    const mid = fold(frames.slice(0, lastDelta + 1))
    const streaming = mid.items.filter((v) => v.kind === 'assistant')
    expect(streaming).toEqual([{ kind: 'assistant', id: 'item_msg_4', text: 'Hello, world!', streaming: true }])
    expect(mid.status).toBe('in_progress')

    const done = fold(frames)
    expect(done.items.filter((v) => v.kind === 'assistant')).toEqual([
      { kind: 'assistant', id: 'item_msg_4', text: 'Hello, world!', streaming: false },
    ])
    expect(kinds(done)).toEqual(['user', 'reasoning', 'assistant'])
    expect(done.items[1]).toEqual({ kind: 'reasoning', id: 'item_reason_4', text: 'The user wants a greeting.' })
    expect(done.status).toBe('idle')
    expect(done.lastEventId).toBe(String(TWO_TURNS.historyThrough))
  })

  it('finalizes a streaming message when the turn completes without an item.done', () => {
    let s = applyEvent(initialState(SID), {
      id: '1',
      event: { type: 'agent.session.turn.output_text.delta', event_id: 'e1', item_id: 'm1', output_index: 0, content_index: 0, session_id: SID, turn_id: 't', delta: 'Hi' },
    })
    expect(s.items).toEqual([{ kind: 'assistant', id: 'm1', text: 'Hi', streaming: true }])
    s = applyEvent(s, { id: '2', event: { type: 'agent.session.turn.completed', event_id: 'e2', session_id: SID, turn_id: 'turn_9', turn: turn('completed') } })
    expect(s.items).toEqual([{ kind: 'assistant', id: 'm1', text: 'Hi', streaming: false }])
  })

  it('moves a tool call from running to done with its output', () => {
    const frames = TWO_TURNS.frames
    const call = frames.findIndex((f) => f.event.type === 'agent.session.turn.item.added' && f.event.item.type === 'function_call')
    const running = fold(frames.slice(0, call + 1))
    expect(running.items.at(-1)).toEqual({
      kind: 'tool', id: 'item_fn_8', callId: 'call_1', name: 'search', args: { query: 'docs' }, status: 'running',
    })
    const done = fold(frames.slice(0, call + 2))
    expect(done.items.at(-1)).toEqual({
      kind: 'tool', id: 'item_fn_8', callId: 'call_1', name: 'search', args: { query: 'docs' }, status: 'done', output: '3 results',
    })
  })

  it('marks a tool failed when its output fails, and a re-sent call item does not regress it', () => {
    let s = applyEvent(initialState(SID), {
      id: '1',
      event: { type: 'agent.session.turn.item.added', event_id: 'e1', session_id: SID, turn_id: 't', item: { id: 'f1', type: 'function_call', name: 'x', call_id: 'c1', arguments: '{"a":1}', status: 'in_progress', turn_id: 't' } },
    })
    s = applyEvent(s, {
      id: '2',
      event: { type: 'agent.session.turn.item.done', event_id: 'e2', session_id: SID, turn_id: 't', item: { id: 'o1', type: 'function_call_output', call_id: 'c1', output: 'boom', error: 'boom', status: 'failed', turn_id: 't' } },
    })
    s = applyEvent(s, {
      id: '3',
      event: { type: 'agent.session.turn.item.done', event_id: 'e3', session_id: SID, turn_id: 't', item: { id: 'f1', type: 'function_call', name: 'x', call_id: 'c1', arguments: '{"a":1}', status: 'in_progress', turn_id: 't' } },
    })
    expect(s.items).toEqual([{ kind: 'tool', id: 'f1', callId: 'c1', name: 'x', args: { a: 1 }, status: 'failed', output: 'boom' }])
  })

  it('adds an action view on requires_action and removes it once answered', () => {
    const frames = APPROVAL.frames
    const ask = frames.findIndex((f) => f.event.type === 'agent.session.requires_action')
    const asked = fold(frames.slice(0, ask + 1))
    expect(asked.status).toBe('requires_action')
    const action = asked.items.find((v) => v.kind === 'action')
    expect(action).toMatchObject({ kind: 'action', action: { type: 'approval', id: 'appr_1', kind: 'tool_approval' } })

    const answered = fold(frames.slice(0, ask + 2))
    expect(answered.items.some((v) => v.kind === 'action')).toBe(false)
    expect(answered.status).toBe('in_progress')

    const end = fold(frames)
    expect(kinds(end)).toEqual(['user', 'tool', 'assistant'])
    expect(end.status).toBe('idle')
  })

  it('handles a wire function_call action from durable frames', () => {
    const fn: OAIRequiredAction = { type: 'function_call', name: 'lookup', arguments: {}, turn_id: 't', call_id: 'c9' }
    let s = applyEvent(initialState(SID), { id: '1', event: { type: 'agent.session.requires_action', event_id: 'e1', session: session('requires_action', [fn]) } })
    expect(s.items).toEqual([{ kind: 'action', id: 'action:c9', action: fn }])
    s = applyEvent(s, { id: '2', event: { type: 'agent.session.in_progress', event_id: 'e2', session: session('in_progress') } })
    expect(s.items).toEqual([])
  })

  it('keeps an approval from the status snapshot while replayed durable frames arrive', () => {
    const approval: OAIRequiredAction = { type: 'approval', id: 'appr_7', kind: 'user_question', prompt: 'Pick one', options: ['A', 'B'] }
    // The id-less snapshot (GET session) may land before the replay from Last-Event-ID 0.
    let s = applyEvent(initialState(SID), { event: { type: 'agent.session.requires_action', event_id: 'snap', session: session('requires_action', [approval]) } })
    s = applyEvent(s, { id: '1', event: { type: 'agent.session.created', event_id: 'e1', session: session('idle') } })
    s = applyEvent(s, { id: '2', event: { type: 'agent.session.in_progress', event_id: 'e2', session: session('in_progress') } })
    expect(s.items.filter((v) => v.kind === 'action')).toHaveLength(1)
    expect(s.status).toBe('requires_action')
    // A live ephemeral frame without it removes it.
    s = applyEvent(s, { event: { type: 'agent.session.in_progress', event_id: 'e', session: session('in_progress') } })
    expect(s.items).toEqual([])
    expect(s.status).toBe('in_progress')
  })

  it('ignores duplicate and replayed events', () => {
    const frames = TWO_TURNS.frames
    const once = fold(frames)
    // The same id twice.
    const twice = frames.reduce((s, f) => applyEvent(applyEvent(s, f), f), initialState(SID))
    expect(twice).toEqual(once)
    // Replayed ids up to lastEventId after a reconnect.
    const replayed = fold(frames, once)
    expect(replayed).toBe(once)
    // A replay of an older prefix with a fresh seen set (ids at or below lastEventId).
    const resumed = fold(frames.slice(0, 10), { ...once, seen: new Set() })
    expect(resumed.items).toEqual(once.items)
  })

  it('history via applyItems followed by live events equals the live-only fold', () => {
    const { frames, historyThrough } = TWO_TURNS
    const items: StoredSessionItem[] = frames
      .slice(0, historyThrough)
      .flatMap((f) => (f.event.type === 'agent.session.turn.item.done' ? [f.event.item] : []))
    const live = fold(frames)
    const history = fold(frames.slice(historyThrough), applyItems(initialState(SID), items))
    expect(history.items).toEqual(live.items)
    expect(history.status).toEqual(live.status)
    expect(history.lastEventId).toEqual(live.lastEventId)
  })

  it('applyItems maps function call outputs, skips subagent items and does not touch event ids', () => {
    const items: StoredSessionItem[] = [
      { id: 'u1', type: 'message', role: 'user', content: [{ type: 'input_text', text: 'hi' }], status: 'completed', turn_id: 't' },
      { id: 'f1', type: 'function_call', name: 'ls', call_id: 'c1', arguments: {}, status: 'in_progress', turn_id: 't' },
      { id: 'o1', type: 'function_call_output', call_id: 'c1', output: 'a b', status: 'completed', turn_id: 't' },
      { id: 'x1', type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'child' }], status: 'completed', turn_id: 't', subagent_id: 'sub_1' },
      { id: 'cmd', type: 'command_execution', command: 'ls', status: 'completed', output: 'a', turn_id: 't' },
    ]
    const s = applyItems(initialState(SID), items)
    expect(s.items).toEqual([
      { kind: 'user', id: 'u1', text: 'hi' },
      { kind: 'tool', id: 'f1', callId: 'c1', name: 'ls', args: {}, status: 'done', output: 'a b' },
      { kind: 'tool', id: 'cmd', callId: 'cmd', name: 'command', args: { command: 'ls' }, status: 'done', output: 'a' },
    ])
    expect(s.lastEventId).toBeNull()
    expect(s.seen.size).toBe(0)
  })

  it('ephemeral events do not move lastEventId or enter seen', () => {
    const s = applyEvent(initialState(SID), { id: '5', event: { type: 'agent.session.idle', event_id: 'e5', session: session('idle') } })
    const next = applyEvent(s, { event: { type: 'agent.session.in_progress', event_id: 'snap', session: session('in_progress') } })
    expect(next.lastEventId).toBe('5')
    expect(next.seen).toEqual(new Set(['5']))
    expect(next.status).toBe('in_progress')
    // The same ephemeral frame twice still applies (it carries no id to de-duplicate on).
    const again = applyEvent(next, { event: { type: 'agent.session.idle', event_id: 'snap2', session: session('idle') } })
    expect(again.status).toBe('idle')
  })

  it('adds a notice for failed, interrupted and cancelled turns, and for error events', () => {
    let s = applyEvent(initialState(SID), {
      id: '1',
      event: { type: 'agent.session.turn.failed', event_id: 'e1', session_id: SID, turn_id: 'turn_9', turn: turn('failed', { code: 'model_error', message: 'Model unavailable' }) },
    })
    s = applyEvent(s, {
      id: '2',
      event: { type: 'agent.session.turn.cancelled', event_id: 'e2', session_id: SID, turn_id: 'turn_10', turn: { ...turn('cancelled', { code: 'interrupted', message: 'Turn interrupted by a server restart' }), id: 'turn_10' } },
    })
    s = applyEvent(s, {
      id: '3',
      event: { type: 'agent.session.turn.cancelled', event_id: 'e3', session_id: SID, turn_id: 'turn_11', turn: { ...turn('cancelled'), id: 'turn_11' } },
    })
    s = applyEvent(s, { event: { type: 'error', event_id: 'err1', session_id: SID, error: { message: 'dispatch failed' } } })
    expect(s.items).toEqual<MessageView[]>([
      { kind: 'notice', id: 'notice:turn_9', level: 'failed', message: 'Model unavailable' },
      { kind: 'notice', id: 'notice:turn_10', level: 'interrupted', message: 'Turn interrupted by a server restart' },
      { kind: 'notice', id: 'notice:turn_11', level: 'cancelled', message: 'Stopped' },
      { kind: 'notice', id: 'notice:err1', level: 'failed', message: 'dispatch failed' },
    ])
  })

  it('shows subagent turns as delegation cards with their status', () => {
    const child = { ...turn('in_progress'), id: 'turn_c', subagent_id: 'researcher' }
    let s = applyEvent(initialState(SID), { id: '1', event: { type: 'agent.session.turn.created', event_id: 'e1', session_id: SID, turn: child } })
    expect(s.items).toEqual([{ kind: 'subagent', id: 'subagent:turn_c', name: 'researcher', status: 'in_progress' }])
    s = applyEvent(s, { id: '2', event: { type: 'agent.session.turn.completed', event_id: 'e2', session_id: SID, turn_id: 'turn_c', turn: { ...child, status: 'completed' } } })
    expect(s.items).toEqual([{ kind: 'subagent', id: 'subagent:turn_c', name: 'researcher', status: 'completed' }])
  })

  it('an optimistic user message is replaced by the server item with the same text', () => {
    let s = appendLocalUserMessage(initialState(SID), 'Say hello')
    expect(s.items).toEqual([{ kind: 'user', id: 'local:1', text: 'Say hello' }])
    s = fold(TWO_TURNS.frames.slice(0, 6), s)
    expect(s.items.filter((v) => v.kind === 'user')).toEqual([{ kind: 'user', id: 'item_msg_3', text: 'Say hello' }])
  })

  it('keeps pending actions after the conversation even when they arrive first', () => {
    const approval: OAIRequiredAction = { type: 'approval', id: 'appr_7', kind: 'tool_approval', prompt: 'Approve', options: ['approve', 'deny'] }
    let s = applyEvent(initialState(SID), { event: { type: 'agent.session.requires_action', event_id: 'snap', session: session('requires_action', [approval]) } })
    s = fold(TWO_TURNS.frames.slice(0, 6), s)
    expect(kinds(s)).toEqual(['user', 'action'])
  })

  it('replaying a message the items already show never doubles its text, even mid-replay', () => {
    const { frames, historyThrough } = TWO_TURNS
    const items = frames.slice(0, historyThrough).flatMap((f) => (f.event.type === 'agent.session.turn.item.done' ? [f.event.item] : []))
    const loaded = applyItems(initialState(SID), items)
    const lastDelta = frames.slice(0, historyThrough).findLastIndex((f) => f.event.type === 'agent.session.turn.output_text.delta')
    const mid = fold(frames.slice(0, lastDelta + 1), loaded)
    expect(mid.items).toEqual(loaded.items)
    expect(fold(frames.slice(0, historyThrough), loaded).items).toEqual(loaded.items)
  })

  it('a replayed notice for an older turn lands inside that turn', () => {
    const items: StoredSessionItem[] = [
      { id: 'u1', type: 'message', role: 'user', content: [{ type: 'input_text', text: 'one' }], status: 'completed', turn_id: 'turn_a' },
      { id: 'a1', type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'reply' }], status: 'completed', turn_id: 'turn_a' },
      { id: 'u2', type: 'message', role: 'user', content: [{ type: 'input_text', text: 'two' }], status: 'completed', turn_id: 'turn_b' },
    ]
    let s = applyItems(initialState(SID), items)
    s = applyEvent(s, { id: '1', event: { type: 'agent.session.turn.cancelled', event_id: 'e1', session_id: SID, turn_id: 'turn_a', turn: { ...turn('cancelled'), id: 'turn_a' } } })
    s = applyEvent(s, { id: '2', event: { type: 'agent.session.turn.failed', event_id: 'e2', session_id: SID, turn_id: 'turn_b', turn: { ...turn('failed', { code: 'x', message: 'boom' }), id: 'turn_b' } } })
    expect(s.items.map((v) => v.id)).toEqual(['u1', 'a1', 'notice:turn_a', 'u2', 'notice:turn_b'])
  })

  it('a reply after a steering message follows it', () => {
    let s = fold(TWO_TURNS.frames.slice(0, 6)) // turn_2 open, its user message shown
    s = appendLocalUserMessage(s, 'actually, be brief')
    s = fold(TWO_TURNS.frames.slice(6, TWO_TURNS.historyThrough), s)
    expect(s.items.map((v) => v.id)).toEqual(['item_msg_3', 'local:1', 'item_reason_4', 'item_msg_4'])
  })

  it('does not mutate the previous state', () => {
    const s = initialState(SID)
    const before = applyItems(s, [])
    const snapshot = structuredClone(before)
    fold(TWO_TURNS.frames, before)
    expect(before).toEqual(snapshot)
  })
})
