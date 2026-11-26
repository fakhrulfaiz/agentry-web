import { describe, expect, it } from 'vitest'
import type { OAIApprovalAction, OAITurn } from '@/api/types'
import type { ConversationState, MessageView } from '@/chat/reducer'
import { splitSubagentActions, waitingOnSubagentsOnly } from '@/chat/subagent-actions'

const approval = (id: string, subagent_id?: string): OAIApprovalAction => ({
  type: 'approval', id, kind: 'tool_approval', prompt: 'Approve bash', options: ['approve', 'deny'], ...(subagent_id ? { subagent_id } : {}),
})
const card: MessageView = { kind: 'subagent', id: 'subagent:c1', sessionId: 's', subagentId: 'c1', name: 'Look', status: 'in_progress' }

describe('splitSubagentActions', () => {
  it('moves a subagent approval into its card and keeps the others in the list', () => {
    const own: MessageView = { kind: 'action', id: 'action:a', action: approval('a') }
    const child: MessageView = { kind: 'action', id: 'action:b', action: approval('b', 'c1') }
    const orphan: MessageView = { kind: 'action', id: 'action:c', action: approval('c', 'c9') }
    const { items, bySubagent } = splitSubagentActions([card, own, child, orphan])
    expect(items).toEqual([card, own, orphan])
    expect(bySubagent.get('c1')).toEqual([approval('b', 'c1')])
    expect(bySubagent.has('c9')).toBe(false)
  })

  it('returns the same list when nothing moves', () => {
    const items: MessageView[] = [card]
    expect(splitSubagentActions(items).items).toBe(items)
  })
})

describe('waitingOnSubagentsOnly', () => {
  const child: MessageView = { kind: 'action', id: 'action:b', action: approval('b', 'c1') }
  const own: MessageView = { kind: 'action', id: 'action:a', action: approval('a') }
  const turn = (status: OAITurn['status']) => ({ id: 't1', status }) as OAITurn
  const state = (over: Partial<Pick<ConversationState, 'status' | 'items' | 'openTurn' | 'turns'>>) => ({
    status: 'requires_action' as const, items: [card, child], openTurn: null, turns: [turn('completed')], ...over,
  })

  it('is true between turns when only a subagent is waiting', () => {
    expect(waitingOnSubagentsOnly(state({}))).toBe(true)
  })

  it('is false while the parent has a turn open or running', () => {
    expect(waitingOnSubagentsOnly(state({ openTurn: 't1' }))).toBe(false)
    expect(waitingOnSubagentsOnly(state({ turns: [turn('in_progress')] }))).toBe(false)
  })

  it('is false when the parent itself waits, or nothing waits', () => {
    expect(waitingOnSubagentsOnly(state({ items: [card, child, own] }))).toBe(false)
    expect(waitingOnSubagentsOnly(state({ items: [card] }))).toBe(false)
    expect(waitingOnSubagentsOnly(state({ status: 'in_progress' }))).toBe(false)
  })
})
