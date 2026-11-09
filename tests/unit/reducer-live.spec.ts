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
import type { OAISessionEvent, StoredSessionItem } from '@/api/types'
import {
  appendLocalUserMessage,
  applyEvent,
  applyItems,
  initialState,
  type ConversationState,
  type MessageView,
} from '@/chat/reducer'
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
