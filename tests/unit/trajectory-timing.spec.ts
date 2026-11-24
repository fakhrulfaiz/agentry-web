import { describe, expect, it } from 'vitest'
import type { OAITurn, StoredSessionItem } from '@/api/types'
import { buildTrajectory, timelineSpans } from '@/ui/trajectory/build-trajectory'
import { formatSeconds } from '@/ui/trajectory/format'

const usage = (input: number, output: number, reasoning: number) => ({
  input_tokens: input, input_tokens_details: { cached_tokens: 0 }, output_tokens: output, output_tokens_details: { reasoning_tokens: reasoning }, total_tokens: input + output,
})

const turn: OAITurn = { id: 'turn_1', object: 'agent.session.turn', session_id: 's', status: 'completed', created_at: 10, started_at: 10, completed_at: 13, usage: null } as unknown as OAITurn

/** One turn as the API now saves it: timed user message, a step that thinks and calls a tool, the result, a final step. */
const items = [
  { id: 'item_msg_2', type: 'message', role: 'user', content: [{ type: 'input_text', text: 'hi' }], status: 'completed', turn_id: 'turn_1', timing: { completed_at_ms: 10_010 } },
  { id: 'item_reason_4', type: 'reasoning', summary: [{ type: 'summary_text', text: 'let me' }], status: 'completed', turn_id: 'turn_1', step: 1, timing: { started_at_ms: 10_100, first_token_at_ms: 10_400, completed_at_ms: 10_900 } },
  { id: 'item_msg_4', type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'let melooking' }], status: 'completed', turn_id: 'turn_1', step: 1, usage: usage(100, 20, 8), timing: { started_at_ms: 10_100, first_token_at_ms: 10_400, completed_at_ms: 10_900 } },
  { id: 'item_fn_5', type: 'function_call', name: 'web_search', call_id: 'c1', arguments: { q: 'x' }, status: 'in_progress', turn_id: 'turn_1', step: 1, timing: { started_at_ms: 10_950, completed_at_ms: 12_000 } },
  { id: 'item_fn_out_6', type: 'function_call_output', call_id: 'c1', output: 'found', status: 'completed', turn_id: 'turn_1', timing: { completed_at_ms: 12_000 } },
  { id: 'item_msg_8', type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'done' }], status: 'completed', turn_id: 'turn_1', step: 2, usage: usage(150, 5, 0), timing: { started_at_ms: 12_050, first_token_at_ms: 12_300, completed_at_ms: 12_500 } },
] as unknown as StoredSessionItem[]

describe('trajectory timing from item timing', () => {
  const t = buildTrajectory([turn], items)
  const records = t.turns[0]!.records
  const step1 = records.find((r) => r.kind === 'assistant' && r.step === 1)!
  const tool = records.find((r) => r.kind === 'tool')!

  it('times an assistant step with its first token and usage', () => {
    expect(step1).toMatchObject({ startedAt: 10.1, firstTokenAt: 10.4, endedAt: 10.9, usage: usage(100, 20, 8) })
  })

  it('times a tool call from call to result, and a user message at when it was logged', () => {
    expect(tool).toMatchObject({ startedAt: 10.95, endedAt: 12 })
    expect(records.find((r) => r.kind === 'user')).toMatchObject({ startedAt: 10.01, endedAt: 10.01 })
  })

  it('adds up step usage for a turn that reported none', () => {
    expect(t.turns[0]!.usage).toEqual({ input_tokens: 250, input_tokens_details: { cached_tokens: 0 }, output_tokens: 25, output_tokens_details: { reasoning_tokens: 8 }, total_tokens: 275 })
  })

  it('draws assistant and tool lanes next to turns', () => {
    const spans = timelineSpans(t)
    expect(spans.map((s) => s.lane)).toEqual(['turn', 'assistant', 'tool', 'assistant'])
    expect(spans.find((s) => s.lane === 'assistant')).toMatchObject({ start: 10.1, firstToken: 10.4, end: 10.9, label: 'Step 1' })
    expect(spans.find((s) => s.lane === 'tool')).toMatchObject({ start: 10.95, end: 12, label: 'web_search' })
  })

  it('leaves a running tool call open', () => {
    const running = buildTrajectory([{ ...turn, status: 'in_progress', completed_at: null } as unknown as OAITurn], items.slice(0, 4).map((i) => (i.id === 'item_fn_5' ? { ...i, timing: { started_at_ms: 10_950 } } : i)) as StoredSessionItem[])
    const call = running.turns[0]!.records.find((r) => r.kind === 'tool')!
    expect(call.startedAt).toBe(10.95)
    expect(call.endedAt).toBeUndefined()
  })
})

describe('formatSeconds', () => {
  it('keeps short durations readable', () => {
    expect(formatSeconds(0.34)).toBe('340 ms')
    expect(formatSeconds(1.25)).toBe('1.3 s')
    expect(formatSeconds(13)).toBe('13 s')
    expect(formatSeconds(125)).toBe('2 m 5 s')
  })
})
