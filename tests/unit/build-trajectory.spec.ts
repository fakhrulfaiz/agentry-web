import { describe, expect, it } from 'vitest'
import type { OAITurn, StoredSessionItem } from '@/api/types'
import {
  allRecords,
  buildTrajectory,
  recordsInInterval,
  searchRecords,
  timelineSpans,
  turnRecordStatus,
  type SubagentRun,
} from '@/ui/trajectory/build-trajectory'
import { STATUS } from '@/ui/trajectory/labels'
import delegation from '../fixtures/live/subagent.json'
import live from '../fixtures/live/web-search.json'

const TURNS = live.turns as OAITurn[]
const ITEMS = live.items as StoredSessionItem[]
const D_TURNS = delegation.turns as OAITurn[]
const D_ITEMS = delegation.items as StoredSessionItem[]
const RUNS = delegation.subagents as unknown as SubagentRun[]
const usage = { input_tokens: 1200, input_tokens_details: { cached_tokens: 0 }, output_tokens: 340, output_tokens_details: { reasoning_tokens: 120 }, total_tokens: 1540 }

describe('buildTrajectory on the recorded web-search turn', () => {
  const t = buildTrajectory(TURNS, ITEMS)

  it('groups the turn into User, Assistant steps and Tool calls, in order', () => {
    expect(t.between).toEqual([])
    expect(t.turns.map((x) => [x.id, x.index, x.status])).toEqual([['turn_4', 1, 'completed']])
    expect(t.turns[0].records.map((r) => [r.kind, r.step ?? r.name ?? null])).toEqual([
      ['user', null],
      ['assistant', 1],
      ['tool', 'web_search'],
      ['assistant', 2],
      ['tool', 'web_fetch'],
      ['assistant', 3],
    ])
  })

  it('an Assistant step has its thinking and its own text, without the repeated thinking', () => {
    const steps = t.turns[0].records.filter((r) => r.kind === 'assistant')
    expect(steps[0].thinking).toMatch(/^The user wants a web search/)
    expect(steps[0].output).toBe('')
    expect(steps[0].title).toMatch(/^The user wants a web search/) // a step without text previews its thinking
    expect(steps[2].output).toMatch(/^The latest stable Node\.js release is \*\*v26\.13\.0\*\*/)
    expect(steps[2].title).toMatch(/^The latest stable Node\.js release is v26\.13\.0 /)
    expect(steps[2].chatItemId).toBe('item_msg_32')
    expect(steps[0].chatItemId).toBe('item_reason_18')
  })

  it('a Tool call has its recorded name, argument summary, input, output and step', () => {
    const [search, fetch] = t.turns[0].records.filter((r) => r.kind === 'tool')
    expect(search).toMatchObject({ name: 'web_search', title: 'latest stable Node.js release version, Node.js current LTS version', status: 'completed', stepId: 'item_reason_18' })
    expect(search.input).toEqual({ queries: ['latest stable Node.js release version', 'Node.js current LTS version'] })
    expect(typeof fetch.output).toBe('string')
    expect(fetch.chatItemId).toBe('item_fn_27')
  })

  it('carries the turn timing and usage only when recorded', () => {
    expect(t.turns[0]).toMatchObject({ startedAt: 1794192041, endedAt: 1794192054 })
    expect(t.turns[0].usage).toBeUndefined()
    expect(buildTrajectory([{ ...TURNS[0], usage }], ITEMS).turns[0].usage).toEqual(usage)
    // Items have no timestamps: no record gets made-up timing.
    expect(allRecords(t).every((r) => r.startedAt === undefined && r.endedAt === undefined)).toBe(true)
  })

  it('a call without output is pending while the turn runs, then settles with the turn', () => {
    const callOnly = ITEMS.slice(0, 4)
    const running = buildTrajectory([{ ...TURNS[0], status: 'in_progress', completed_at: null }], callOnly)
    expect(running.turns[0].records.map((r) => r.status)).toEqual(['completed', 'pending', 'pending'])
    expect(running.turns[0].endedAt).toBeUndefined()
    const failed = buildTrajectory([{ ...TURNS[0], status: 'failed' }], callOnly)
    expect(failed.turns[0].records.find((r) => r.kind === 'tool')?.status).toBe('failed')
    const done = buildTrajectory(TURNS, callOnly)
    expect(done.turns[0].records.find((r) => r.kind === 'tool')?.status).toBe('completed')
  })

  it('a cancelled turn shows Cancelled: its call without output and its last step, not Completed', () => {
    const callOnly = ITEMS.slice(0, 4)
    const cancelled = buildTrajectory([{ ...TURNS[0], status: 'cancelled' }], callOnly)
    expect(turnRecordStatus(cancelled.turns[0].status)).toBe('cancelled')
    expect(STATUS[turnRecordStatus('cancelled')].label).toBe('Cancelled')
    expect(cancelled.turns[0].records.map((r) => [r.kind, r.status])).toEqual([
      ['user', 'completed'],
      ['assistant', 'cancelled'],
      ['tool', 'cancelled'],
    ])
    expect(timelineSpans(cancelled)[0].status).toBe('cancelled')
  })

  it('the thinking is cut from the answer only on an exact leading match at a boundary', () => {
    const step = (reasoning: string, message: string) => {
      const items = [
        { id: 'item_reason_5', type: 'reasoning', summary: [{ type: 'summary_text', text: reasoning }], status: 'completed', turn_id: 'turn_4' },
        { id: 'item_msg_5', type: 'message', role: 'assistant', content: [{ type: 'output_text', text: message }], status: 'completed', turn_id: 'turn_4' },
      ] as StoredSessionItem[]
      return buildTrajectory(TURNS, items).turns[0].records[0].output
    }
    expect(step('Let me check.', 'Let me check.It is v26.')).toBe('It is v26.')
    // A backend that does not repeat the thinking: a short thought never eats the answer.
    expect(step('Ok', 'Okay, the answer is 4.')).toBe('Okay, the answer is 4.')
  })

  it('items of a turn not loaded yet go to Between turns', () => {
    expect(buildTrajectory([], ITEMS.slice(0, 2)).between.map((r) => r.kind)).toEqual(['user', 'assistant'])
  })
})

describe('buildTrajectory on the recorded delegation', () => {
  const t = buildTrajectory(D_TURNS, D_ITEMS, RUNS)
  const call = t.turns[0].records.find((r) => r.name === 'subagent')!

  it('nests the subagent activity as subcalls under the delegating call', () => {
    expect(call.title).toBe('List workspace files and count')
    expect(call.subagentId).toBe(RUNS[0].subagent.id)
    expect(call.subcalls?.length).toBeGreaterThan(0)
    expect(call.subcalls?.every((r) => r.kind === 'subtool' && r.chatItemId === call.chatItemId)).toBe(true)
    expect(call.subcalls?.map((r) => r.subKind)).toContain('tool')
    // Child ids reuse the parent's item ids; records stay unique.
    const ids = allRecords(t).map((r) => r.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('times the delegating call by the subagent run and takes its status', () => {
    const child = RUNS[0].turns[0]
    expect(call).toMatchObject({ startedAt: child.started_at, endedAt: child.completed_at, status: 'completed' })
  })

  it('keeps the two turns apart; the follow-up turn is still running', () => {
    expect(t.turns.map((x) => [x.index, x.status])).toEqual([[1, 'completed'], [2, 'in_progress']])
    const tools = t.turns[1].records.filter((r) => r.kind === 'tool')
    expect(tools.map((r) => r.name)).toEqual(['command', 'glob', 'glob', 'command'])
    expect(t.turns[1].endedAt).toBeUndefined()
  })

  it('without subagent data the call has no subcalls', () => {
    expect(buildTrajectory(D_TURNS, D_ITEMS).turns[0].records.find((r) => r.name === 'subagent')?.subcalls).toBeUndefined()
  })
})

describe('search and the interval filter', () => {
  it('search is case-insensitive and reaches folded subcalls', () => {
    const t = buildTrajectory(D_TURNS, D_ITEMS, RUNS)
    const hits = searchRecords(t, 'LS -LA')
    expect([...hits].some((id) => id.startsWith(`${RUNS[0].subagent.id}/`))).toBe(true)
    expect(searchRecords(t, '   ').size).toBe(0)
    expect([...searchRecords(buildTrajectory(TURNS, ITEMS), 'web_fetch')]).toEqual(['item_fn_27'])
  })

  it('the interval keeps records active in it, by their own timing or their turn', () => {
    const t = buildTrajectory(D_TURNS, D_ITEMS, RUNS)
    const now = 1794193100
    const call = t.turns[0].records.find((r) => r.name === 'subagent')!
    // Past turn 1's end, only the subagent run (and the follow-up turn) is active.
    const late = recordsInInterval(t, call.endedAt! - 1, call.endedAt! - 1, now)
    expect(late.has(call.id)).toBe(true)
    expect(late.has('item_msg_8')).toBe(false)
    expect(recordsInInterval(t, 0, now, now).size).toBe(allRecords(t).length)
  })

  it('the overview spans are turns and subagent runs only', () => {
    const spans = timelineSpans(buildTrajectory(D_TURNS, D_ITEMS, RUNS))
    expect(spans.map((s) => [s.lane, s.label])).toEqual([
      ['turn', 'Turn 1'],
      ['subagent', 'List workspace files and count'],
      ['turn', 'Turn 2'],
    ])
    expect(spans[2].end).toBeUndefined()
  })
})
