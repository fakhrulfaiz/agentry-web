// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import '../helpers/dom'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it } from 'vitest'
import type { OAITurn } from '@/api/types'
import type { MessageView } from '@/chat/reducer'
import { groupTurns } from '@/ui/chat/group-turns'
import { currentStepLabel, groupLabel, runningLabel, TurnGroup } from '@/ui/chat/TurnGroup'

afterEach(cleanup)

const items: MessageView[] = [
  { kind: 'user', id: 'u', text: 'hi' },
  { kind: 'reasoning', id: 'r', text: 'hmm', streaming: false },
  { kind: 'tool', id: 't', callId: 'c', name: 'ls', args: {}, status: 'done' },
  { kind: 'assistant', id: 'a', text: 'Final answer', streaming: false },
]
const turnOf = new Map([['r', 't1'], ['t', 't1'], ['a', 't1']])
const turn = (status: OAITurn['status']): OAITurn => ({ id: 't1', object: 'agent.session.turn', session_id: 's', agent_id: 'a', status, created_at: 0, started_at: 10, completed_at: 135 })

describe('groupTurns', () => {
  it('keeps a running turn expanded', () => {
    expect(groupTurns(items, turnOf, [turn('in_progress')]).every((e) => e.type === 'view')).toBe(true)
  })
  it('says what the turn did: commands, files edited, subagents, other tools', () => {
    const views: MessageView[] = [
      { kind: 'user', id: 'u', text: 'go' },
      { kind: 'tool', id: 'c1', callId: 'c1', name: 'command', args: {}, status: 'done' },
      { kind: 'tool', id: 'c2', callId: 'c2', name: 'sandbox_exec', args: {}, status: 'done' },
      { kind: 'tool', id: 'w1', callId: 'w1', name: 'write', args: {}, status: 'done' },
      { kind: 'tool', id: 'e1', callId: 'e1', name: 'edit', args: {}, status: 'done' },
      { kind: 'assistant', id: 'a', text: 'Done', streaming: false },
    ]
    const of = new Map(views.slice(1).map((v) => [v.id, 't1']))
    const g = groupTurns(views, of, [turn('completed')])[1]
    expect(groupLabel(g as never)).toBe('Worked for 2m 5s · 2 commands · 2 files edited')
  })
  it('reads "Thought for" when the turn only reasoned', () => {
    expect(groupLabel({ thinking: true, commands: 0, edits: 0, subagents: 0, tools: 0, steps: 1, seconds: 12 })).toBe('Thought for 12s')
  })
  it('leaves a single quick tool call as one line, and keeps a failed tool visible', () => {
    const one: MessageView[] = [{ kind: 'user', id: 'u', text: 'go' }, { kind: 'tool', id: 't', callId: 'c', name: 'ls', args: {}, status: 'done' }, { kind: 'assistant', id: 'a', text: 'ok', streaming: false }]
    const of = new Map([['t', 't1'], ['a', 't1']])
    expect(groupTurns(one, of, [turn('completed')]).every((e) => e.type === 'view')).toBe(true)
    const failed: MessageView[] = [...items.slice(0, 3), { kind: 'tool', id: 'f', callId: 'f', name: 'command', args: {}, status: 'failed' }, items[3]!]
    const entries = groupTurns(failed, new Map([...turnOf, ['f', 't1']]), [turn('completed')])
    expect(entries.map((e) => (e.type === 'group' ? 'group' : e.view.id))).toEqual(['u', 'group', 'f', 'a'])
  })
  it('folds a finished turn above its final answer', () => {
    const entries = groupTurns(items, turnOf, [turn('completed')])
    expect(entries.map((e) => (e.type === 'group' ? 'group' : e.view.id))).toEqual(['u', 'group', 'a'])
    expect(groupLabel(entries[1] as never)).toBe('Worked for 2m 5s · 1 tool')
  })
})

describe('TurnGroup', () => {
  it('is collapsed with a summary and expands on click', async () => {
    const group = groupTurns(items, turnOf, [turn('completed')])[1]
    if (group?.type !== 'group') throw new Error('no group')
    let open = false
    const view = () => <TurnGroup group={group} open={open} onOpenChange={(o) => { open = o; rerender(view()) }}><p>inside</p></TurnGroup>
    const { rerender } = render(view())
    expect(screen.getByText('Worked for 2m 5s · 1 tool')).toBeInTheDocument()
    const trigger = screen.getByRole('button', { name: /Worked for/ })
    expect(trigger).toHaveAttribute('aria-expanded', 'false')
    await userEvent.click(trigger)
    expect(trigger).toHaveAttribute('aria-expanded', 'true')
  })
})

describe('live running turns', () => {
  const running: MessageView[] = [
    { kind: 'user', id: 'u', text: 'go' },
    { kind: 'reasoning', id: 'r', text: 'plan', streaming: false },
    { kind: 'tool', id: 'c1', callId: 'c1', name: 'command', args: { command: 'ls' }, status: 'done' },
    { kind: 'tool', id: 'c2', callId: 'c2', name: 'command', args: { command: 'pnpm test' }, status: 'running' },
    { kind: 'action', id: 'x', action: { type: 'tool_approval' } as never },
    { kind: 'assistant', id: 'a', text: 'Running the tests now', streaming: true },
  ]
  const of = new Map(running.slice(1).map((v) => [v.id, 't1']))

  it('folds a running turn into one live group; actions and the newest text stay outside', () => {
    const entries = groupTurns(running, of, [turn('in_progress')], { live: true })
    const group = entries.find((e) => e.type === 'group')
    expect(group).toMatchObject({ type: 'group', running: true, steps: 3, startedAt: 10 })
    expect(group && group.type === 'group' && group.current?.id).toBe('c2')
    const outside = entries.filter((e) => e.type === 'view').map((e) => e.type === 'view' && e.view.id)
    expect(outside).toEqual(['u', 'x', 'a'])
  })

  it('leaves a running turn expanded without live mode ("Always show steps")', () => {
    expect(groupTurns(running, of, [turn('in_progress')]).every((e) => e.type === 'view')).toBe(true)
  })

  it('describes the step in progress', () => {
    expect(currentStepLabel({ kind: 'tool', id: 't', callId: 't', name: 'command', args: { command: 'pnpm test' }, status: 'running' })).toBe('command pnpm test')
    expect(currentStepLabel({ kind: 'reasoning', id: 'r', text: '', streaming: true })).toBe('Thinking…')
    expect(currentStepLabel(undefined)).toBe('Working…')
    expect(runningLabel({ current: undefined, steps: 4, startedAt: 100 }, 112)).toBe('Working… · 4 steps · 12s')
  })

  it('shows a spinner and the live line while running', () => {
    const group = groupTurns(running, of, [turn('in_progress')], { live: true }).find((e) => e.type === 'group')!
    render(<TurnGroup group={group as never} open={false} onOpenChange={() => {}}><p>steps</p></TurnGroup>)
    expect(screen.getByTestId('turn-group')).toHaveAttribute('data-running')
    expect(screen.getByText(/^command pnpm test · 3 steps/)).toBeInTheDocument()
  })
})
