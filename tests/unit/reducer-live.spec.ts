/**
 * The reducer against a turn recorded from the real backend
 * (`tests/fixtures/live/web-search.json`, `scripts/record-fixture.ts`).
 *
 * What the backend really sends: the SSE stream carries status, turn, and
 * assistant-message frames only. Reasoning, function calls and their outputs
 * (and the user message) exist only in `GET /items`. A saved assistant message
 * repeats its step's reasoning in front of its text (`item_reason_N` +
 * `item_msg_N`), and the stream's text for a step without text chunks is that
 * reasoning too. Function calls stay `in_progress`; the output item finishes them.
 */
import { describe, expect, it } from 'vitest'
import type { OAISessionEvent, OAISubagent, OAITurn, StoredSessionItem } from '@/api/types'
import {
  appendLocalUserMessage,
  applyEvent,
  applyItems,
  applySubagents,
  applyTurns,
  type SubagentActivity,
  initialState,
  type ConversationState,
  type MessageView,
} from '@/chat/reducer'
import delegation from '../fixtures/live/subagent.json'
import live from '../fixtures/live/web-search.json'

interface RecordedFrame {
  id?: string
  data: OAISessionEvent
}

const FIXTURE = live as unknown as { session_id: string; prompt: string; frames: RecordedFrame[]; items: StoredSessionItem[] }
const SID = FIXTURE.session_id
const FRAMES = FIXTURE.frames.map((f) => ({ ...(f.id !== undefined && { id: f.id }), event: f.data }))
const ITEMS = FIXTURE.items

const fold = (frames: typeof FRAMES, s: ConversationState = initialState(SID)) => frames.reduce(applyEvent, s)
const ids = (s: ConversationState) => s.items.map((v) => v.id)
const ofKind = <K extends MessageView['kind']>(s: ConversationState, kind: K) =>
  s.items.filter((v): v is Extract<MessageView, { kind: K }> => v.kind === kind)

const reasoningItems = ITEMS.filter((i) => i.type === 'reasoning')
const calls = ITEMS.filter((i) => i.type === 'function_call')
const outputs = ITEMS.filter((i) => i.type === 'function_call_output')
/** The log order of the views: every item except outputs (they finish their call's view). */
const LOG_ORDER = ITEMS.filter((i) => i.type !== 'function_call_output').map((i) => i.id)
const reasoningText = (id: string) => {
  const item = reasoningItems.find((r) => r.id === id)
  return item?.type === 'reasoning' ? (item.summary ?? []).map((p) => p.text).join('') : ''
}
const turnEnd = FRAMES.findIndex((f) => f.event.type === 'agent.session.turn.completed')
const finalMessageId = ITEMS.filter((i) => i.type === 'message' && i.role === 'assistant').at(-1)!.id

describe('reducer on a recorded backend turn', () => {
  it('the fixture has the shape this suite relies on', () => {
    expect(reasoningItems.length).toBeGreaterThan(0)
    expect(calls.length).toBeGreaterThan(0)
    expect(outputs.length).toBe(calls.length)
    // The stream carries assistant messages only.
    const streamed = FRAMES.flatMap((f) => (f.event.type === 'agent.session.turn.item.done' ? [f.event.item] : []))
    expect(streamed.every((i) => i.type === 'message' && i.role === 'assistant')).toBe(true)
  })

  it('every reasoning item becomes a reasoning view, never assistant text', () => {
    const s = applyItems(initialState(SID), ITEMS)
    expect(ofKind(s, 'reasoning').map((v) => [v.id, v.text])).toEqual(reasoningItems.map((r) => [r.id, reasoningText(r.id)]))
    for (const a of ofKind(s, 'assistant')) {
      for (const r of reasoningItems) {
        const text = reasoningText(r.id)
        expect(a.text.includes(text), `${a.id} repeats ${r.id}`).toBe(false)
      }
    }
    // The final answer keeps only its own text; steps that were only reasoning are empty.
    const final = ofKind(s, 'assistant').find((v) => v.id === finalMessageId)
    expect(final?.text).toMatch(/v26\.13\.0/)
    expect(final?.text.startsWith('The latest stable Node.js release')).toBe(true)
  })

  it('pairs each function_call with its output by call_id into one done tool view', () => {
    const s = applyItems(initialState(SID), ITEMS)
    const tools = ofKind(s, 'tool')
    expect(tools).toHaveLength(calls.length)
    for (const call of calls) {
      if (call.type !== 'function_call') continue
      const out = outputs.find((o) => o.type === 'function_call_output' && o.call_id === call.call_id)
      const view = tools.find((t) => t.callId === call.call_id)
      expect(view).toMatchObject({ id: call.id, name: call.name, args: call.arguments, status: 'done' })
      expect(view?.output).toBe(out?.type === 'function_call_output' ? out.output : undefined)
    }
  })

  it('keeps the log order', () => {
    expect(ids(applyItems(initialState(SID), ITEMS))).toEqual(LOG_ORDER)
  })

  it('live stream, then the items refresh, equals items then replay (R14) and items alone', () => {
    const itemsOnly = applyItems(initialState(SID), ITEMS)
    const liveThenItems = applyItems(fold(FRAMES), ITEMS)
    const itemsThenReplay = fold(FRAMES, applyItems(initialState(SID), ITEMS))
    expect(liveThenItems.items).toEqual(itemsOnly.items)
    expect(itemsThenReplay.items).toEqual(itemsOnly.items)
    expect(itemsThenReplay.status).toBe('idle')
  })

  it('items refreshed during the turn land in log order around the streamed messages', () => {
    // After each assistant message is done, the hook refreshes the items saved so far.
    let s = initialState(SID)
    for (const [i, frame] of FRAMES.entries()) {
      s = applyEvent(s, frame)
      if (frame.event.type === 'agent.session.turn.item.done') {
        const upTo = ITEMS.findIndex((it) => it.id === (frame.event as { item: { id: string } }).item.id)
        s = applyItems(s, ITEMS.slice(0, upTo + 1))
        expect(ids(s), `after frame ${i}`).toEqual(LOG_ORDER.filter((id) => ids(s).includes(id)))
      }
    }
    s = applyItems(s, ITEMS)
    expect(ids(s)).toEqual(LOG_ORDER)
  })

  it('streams text deltas into the open message; it stays streaming until the turn ends', () => {
    const deltas = FRAMES.flatMap((f, i) => (f.event.type === 'agent.session.turn.output_text.delta' && f.event.item_id === finalMessageId ? [i] : []))
    const mid = fold(FRAMES.slice(0, deltas[Math.floor(deltas.length / 2)] + 1))
    const partial = ofKind(mid, 'assistant').find((v) => v.id === finalMessageId)
    expect(partial?.streaming).toBe(true)
    expect(partial && partial.text.length).toBeGreaterThan(0)

    const beforeEnd = fold(FRAMES.slice(0, turnEnd))
    expect(ofKind(beforeEnd, 'assistant').find((v) => v.id === finalMessageId)?.streaming).toBe(true)
    const ended = fold(FRAMES.slice(0, turnEnd + 1))
    expect(ofKind(ended, 'assistant').every((v) => !v.streaming)).toBe(true)
  })

  it('reasoning that arrives during the turn is streaming (open) until the turn ends', () => {
    const open = applyItems(fold(FRAMES.slice(0, turnEnd)), ITEMS)
    expect(ofKind(open, 'reasoning').every((v) => v.streaming)).toBe(true)
    const ended = applyEvent(open, FRAMES[turnEnd])
    expect(ofKind(ended, 'reasoning').every((v) => !v.streaming)).toBe(true)
    // Loaded from history: already finished.
    expect(ofKind(applyItems(initialState(SID), ITEMS), 'reasoning').every((v) => !v.streaming)).toBe(true)
  })

  it('a step streamed as reasoning text loses it once the reasoning item arrives', () => {
    const firstDone = FRAMES.findIndex((f) => f.event.type === 'agent.session.turn.item.done')
    const id = (FRAMES[firstDone].event as { item: { id: string } }).item.id
    const streamed = fold(FRAMES.slice(0, firstDone + 1))
    expect(ofKind(streamed, 'assistant').find((v) => v.id === id)?.text).not.toBe('')
    const refreshed = applyItems(streamed, ITEMS.slice(0, ITEMS.findIndex((it) => it.id === id) + 1))
    expect(ofKind(refreshed, 'assistant').find((v) => v.id === id)?.text).toBe('')
    // Replayed frames for that message never bring the reasoning text back.
    expect(ofKind(fold(FRAMES, refreshed), 'assistant').find((v) => v.id === id)?.text).toBe('')
  })

  it('the optimistic user bubble is reconciled by the items refresh', () => {
    let s = appendLocalUserMessage(initialState(SID), FIXTURE.prompt)
    s = fold(FRAMES, s)
    expect(s.items[0]).toEqual({ kind: 'user', id: 'local:1', text: FIXTURE.prompt })
    s = applyItems(s, ITEMS)
    expect(ofKind(s, 'user')).toEqual([{ kind: 'user', id: ITEMS[0].id, text: FIXTURE.prompt }])
    expect(ids(s)).toEqual(LOG_ORDER)
  })
})

interface RecordedChild { subagent: OAISubagent; turns: OAITurn[]; items: StoredSessionItem[] }
const DELEGATION = delegation as unknown as { session_id: string; frames: RecordedFrame[]; items: StoredSessionItem[]; subagents: RecordedChild[] }
const CHILD = DELEGATION.subagents[0]
const PARENT_FRAMES = DELEGATION.frames.map((f) => ({ ...(f.id !== undefined && { id: f.id }), event: f.data }))
const spawnCall = DELEGATION.items.find((i) => i.type === 'function_call' && i.name === 'subagent')!
const activity = (turns: OAITurn[], subagent: OAISubagent = CHILD.subagent): SubagentActivity[] => [{ subagent, turns }]

describe('subagents on a recorded delegating turn', () => {
  it('the fixture delegates: a subagent call whose output names the child', () => {
    expect(DELEGATION.subagents).toHaveLength(1)
    const out = DELEGATION.items.find((i) => i.type === 'function_call_output' && spawnCall.type === 'function_call' && i.call_id === spawnCall.call_id)
    expect(out?.type === 'function_call_output' && out.output).toContain(CHILD.subagent.id)
    // Child activity never travels on the parent stream.
    for (const { data } of DELEGATION.frames) {
      if ('turn' in data) expect(data.turn.subagent_id ?? null).toBeNull()
      if ('item' in data) expect((data.item as StoredSessionItem).subagent_id).toBeUndefined()
    }
  })

  it('makes a subagent view right after the call that started it, named by its description', () => {
    const s = applySubagents(applyItems(initialState(DELEGATION.session_id), DELEGATION.items), activity(CHILD.turns))
    const at = s.items.findIndex((v) => v.kind === 'subagent')
    expect(s.items[at - 1]).toMatchObject({ kind: 'tool', id: spawnCall.id })
    const turn = CHILD.turns[0]
    expect(s.items[at]).toEqual({
      kind: 'subagent',
      id: `subagent:${CHILD.subagent.id}`,
      sessionId: DELEGATION.session_id,
      subagentId: CHILD.subagent.id,
      name: 'List workspace files and count',
      status: 'completed',
      startedAt: turn.started_at,
      endedAt: turn.completed_at,
    })
  })

  it('updates the status live, in place, and keeps it through later item refreshes and replays', () => {
    const running: OAITurn = { ...CHILD.turns[0], status: 'in_progress', completed_at: null }
    const base = applyItems(initialState(DELEGATION.session_id), DELEGATION.items)
    const live = applySubagents(base, activity([running], { ...CHILD.subagent, status: 'active', closed_at: undefined }))
    const view = () => live.items.find((v) => v.kind === 'subagent')
    expect(view()).toMatchObject({ status: 'in_progress', endedAt: undefined })
    const done = applySubagents(live, activity(CHILD.turns))
    expect(done.items.map((v) => v.id)).toEqual(live.items.map((v) => v.id))
    expect(done.items.find((v) => v.kind === 'subagent')).toMatchObject({ status: 'completed', endedAt: CHILD.turns[0].completed_at })
    const again = applyItems(PARENT_FRAMES.reduce(applyEvent, done), DELEGATION.items)
    expect(again.items.map((v) => v.id)).toEqual(done.items.map((v) => v.id))
  })

  it('a subagent without turns yet is queued; the parent stream frames do not drop it', () => {
    const s = applySubagents(applyItems(initialState(DELEGATION.session_id), DELEGATION.items.slice(0, 4)), activity([], { ...CHILD.subagent, status: 'active' }))
    expect(s.items.find((v) => v.kind === 'subagent')).toMatchObject({ status: 'queued' })
  })

  it('a command output with no matching call finishes the command before it', () => {
    const s = applyItems(initialState(CHILD.subagent.id), CHILD.items.map(({ subagent_id: _sid, ...item }) => item as StoredSessionItem))
    const cmd = s.items.find((v) => v.kind === 'tool' && v.name === 'command')
    expect(cmd).toMatchObject({ args: { command: 'ls -la' } })
    expect(cmd && 'output' in cmd ? String(cmd.output) : '').toMatch(/^Error: sandbox mode/)
  })
})

describe('turn records and the item log (the trace reads them)', () => {
  const TURN = (live.turns as OAITurn[])[0]

  it('keeps the latest item list and each top-level turn, live from the stream', () => {
    const started = fold(FRAMES.slice(0, turnEnd))
    expect(started.turns.map((t) => [t.id, t.status])).toEqual([['turn_4', 'in_progress']])
    const withItems = applyItems(started, ITEMS.slice(0, 4))
    expect(withItems.log).toEqual(ITEMS.slice(0, 4))
    const ended = fold(FRAMES.slice(turnEnd), withItems)
    expect(ended.turns).toEqual([TURN])
  })

  it('takes turn records from GET /turns and never moves a finished turn back to running', () => {
    const s = applyTurns(initialState(SID), [TURN])
    expect(s.turns).toEqual([TURN])
    // The replay from Last-Event-ID 0 starts with the turn's `created` frame.
    const replayed = fold(FRAMES.slice(0, turnEnd), s)
    expect(replayed.turns).toEqual([TURN])
  })

  it('ignores subagent turns', () => {
    const child = { ...TURN, id: 'turn_child', subagent_id: 'child-1' }
    expect(applyTurns(initialState(SID), [child]).turns).toEqual([])
  })
})

describe('a tool call without output once its turn has ended', () => {
  const callOnly = ITEMS.slice(0, ITEMS.findIndex((i) => i.id === 'item_fn_19') + 1)
  const tool = (s: ConversationState) => s.items.find((v) => v.id === 'item_fn_19')
  const ended = (status: 'completed' | 'failed' | 'cancelled'): typeof FRAMES => {
    const frame = FRAMES[turnEnd]
    if (frame.event.type !== 'agent.session.turn.completed') throw new Error('fixture shape')
    const turn = { ...frame.event.turn, status }
    return [{ ...frame, event: { ...frame.event, type: `agent.session.turn.${status}`, turn } as OAISessionEvent }]
  }

  it('keeps its spinner while the turn runs', () => {
    expect(tool(applyItems(fold(FRAMES.slice(0, turnEnd)), callOnly))).toMatchObject({ status: 'running' })
  })

  it('is done with no output when the turn completes', () => {
    const s = fold(ended('completed'), applyItems(fold(FRAMES.slice(0, turnEnd)), callOnly))
    expect(tool(s)).toMatchObject({ status: 'done' })
    expect(tool(s)).not.toHaveProperty('output')
  })

  it('is failed when the turn fails', () => {
    expect(tool(fold(ended('failed'), applyItems(fold(FRAMES.slice(0, turnEnd)), callOnly)))).toMatchObject({ status: 'failed' })
  })

  it('is settled when the call is first seen after the turn ended (items refreshed late, or GET /turns)', () => {
    expect(tool(applyItems(fold(FRAMES), callOnly))).toMatchObject({ status: 'done' })
    const fromTurns = applyItems(applyTurns(initialState(SID), [{ ...(live.turns as OAITurn[])[0], status: 'failed' }]), callOnly)
    expect(tool(fromTurns)).toMatchObject({ status: 'failed' })
  })

  it('still takes its output when the output arrives later', () => {
    const s = applyItems(fold(ended('completed'), applyItems(fold(FRAMES.slice(0, turnEnd)), callOnly)), ITEMS)
    expect(tool(s)).toMatchObject({ status: 'done' })
    expect(tool(s)).toHaveProperty('output')
  })
})
