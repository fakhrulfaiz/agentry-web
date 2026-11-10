// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import '../helpers/dom'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it } from 'vitest'
import type { OAITurn } from '@/api/types'
import type { MessageView } from '@/chat/reducer'
import { groupTurns } from '@/ui/chat/group-turns'
import { groupLabel, TurnGroup } from '@/ui/chat/TurnGroup'

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
  it('folds a finished turn above its final answer', () => {
    const entries = groupTurns(items, turnOf, [turn('completed')])
    expect(entries.map((e) => (e.type === 'group' ? 'group' : e.view.id))).toEqual(['u', 'group', 'a'])
    expect(groupLabel(entries[1] as never)).toBe('Thought for 2m 5s · 2 steps')
  })
})

describe('TurnGroup', () => {
  it('is collapsed with a summary and expands on click', async () => {
    const group = groupTurns(items, turnOf, [turn('completed')])[1]
    if (group?.type !== 'group') throw new Error('no group')
    let open = false
    const view = () => <TurnGroup group={group} open={open} onOpenChange={(o) => { open = o; rerender(view()) }}><p>inside</p></TurnGroup>
    const { rerender } = render(view())
    expect(screen.getByText('Thought for 2m 5s · 2 steps')).toBeInTheDocument()
    const trigger = screen.getByRole('button', { name: /Thought for/ })
    expect(trigger).toHaveAttribute('aria-expanded', 'false')
    await userEvent.click(trigger)
    expect(trigger).toHaveAttribute('aria-expanded', 'true')
  })
})
