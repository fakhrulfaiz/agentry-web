import { describe, expect, it } from 'vitest'
import type { OAITurn, StoredSessionItem } from '@/api/types'
import { buildTrace } from '@/ui/trace/build-trace'
import live from '../fixtures/live/web-search.json'
import delegation from '../fixtures/live/subagent.json'

const TURNS = live.turns as OAITurn[]
const ITEMS = live.items as StoredSessionItem[]

describe('buildTrace on the recorded web-search turn', () => {
  it('groups each turn with its items in log order, without outputs or empty messages', () => {
    const [turn, ...rest] = buildTrace(TURNS, ITEMS)
    expect(rest).toEqual([])
    expect(turn.id).toBe('turn_4')
    expect(turn.steps.map((s) => [s.kind, s.itemId])).toEqual([
      ['user', 'item_msg_8'],
      ['reasoning', 'item_reason_18'],
      ['tool', 'item_fn_19'],
      ['reasoning', 'item_reason_26'],
      ['tool', 'item_fn_27'],
      ['reasoning', 'item_reason_32'],
      ['assistant', 'item_msg_32'],
    ])
  })

  it('labels tool steps with the tool name and other steps with their first line', () => {
    const steps = buildTrace(TURNS, ITEMS)[0].steps
    expect(steps.filter((s) => s.kind === 'tool').map((s) => s.label)).toEqual(['web_search', 'web_fetch'])
    expect(steps[0].label).toMatch(/^Search the web for the latest stable Node\.js release/)
    // The saved message repeats its step's reasoning first; the label is the answer, without Markdown marks.
    expect(steps.at(-1)?.label).toMatch(/^The latest stable Node\.js release is v26\.13\.0 \(released/)
    for (const s of steps) expect(s.label.length).toBeLessThanOrEqual(80)
  })

  it('takes status, timing and token usage from the turn record', () => {
    const usage = {
      input_tokens: 1200,
      input_tokens_details: { cached_tokens: 0 },
      output_tokens: 340,
      output_tokens_details: { reasoning_tokens: 120 },
      total_tokens: 1540,
    }
    const [turn] = buildTrace([{ ...TURNS[0], usage }], ITEMS)
    expect(turn).toMatchObject({ status: 'completed', startedAt: 1794192041, endedAt: 1794192054, usage })
    // The live backend reports `usage: null`: no usage then.
    expect(buildTrace(TURNS, ITEMS)[0].usage).toBeUndefined()
  })

  it('shows a running turn with the items saved so far and no end time', () => {
    const running: OAITurn = { ...TURNS[0], status: 'in_progress', completed_at: null }
    const [turn] = buildTrace([running], ITEMS.slice(0, 4))
    expect(turn.status).toBe('in_progress')
    expect(turn.endedAt).toBeUndefined()
    expect(turn.steps.map((s) => s.itemId)).toEqual(['item_msg_8', 'item_reason_18', 'item_fn_19'])
  })
})

describe('buildTrace on the recorded delegation', () => {
  const turns = delegation.turns as OAITurn[]
  const items = delegation.items as StoredSessionItem[]

  it('keeps turns apart, marks the delegation as a subagent step and names it by its description', () => {
    const trace = buildTrace(turns, items)
    expect(trace.map((t) => [t.id, t.status])).toEqual([
      ['turn_4', 'completed'],
      ['turn_29', 'in_progress'],
    ])
    const spawn = trace[0].steps.find((s) => s.itemId === 'item_fn_19')
    expect(spawn?.kind).toBe('subagent')
    expect(spawn?.label).toBe('List workspace files and count')
    // A shell command is a tool step named "command".
    expect(trace[1].steps.filter((s) => s.kind === 'tool').map((s) => s.label)).toEqual(['command', 'glob', 'glob', 'command'])
  })

  it('leaves out subagent turns and items', () => {
    const child = delegation.subagents[0]
    const trace = buildTrace([...turns, ...(child.turns as OAITurn[])], [...items, ...(child.items as StoredSessionItem[])])
    expect(trace.map((t) => t.id)).toEqual(['turn_4', 'turn_29'])
  })
})
