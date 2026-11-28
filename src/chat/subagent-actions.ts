/**
 * Approvals and questions a subagent is waiting on (`approval` actions with
 * `subagent_id`) render inside that subagent's card instead of at the end of
 * the chat. One whose card is not shown (yet) stays a standalone row.
 */
import type { OAIApprovalAction } from '@/api/types'
import type { ConversationState, MessageView } from './reducer'

const RUNNING_TURN = new Set(['queued', 'in_progress', 'waiting'])

/**
 * A background subagent waiting on an approval between the parent's turns
 * makes the parent `requires_action`, but the parent itself is idle: the
 * composer stays usable (the card stays inside the subagent's card).
 *
 * @param s - the conversation's status, views, open turn and turns.
 * @returns true when every pending action belongs to a subagent and no
 *   top-level turn is open or running.
 */
export function waitingOnSubagentsOnly(s: Pick<ConversationState, 'status' | 'items' | 'openTurn' | 'turns'>): boolean {
  if (s.status !== 'requires_action' || s.openTurn !== null) return false
  if (s.turns.some((t) => RUNNING_TURN.has(t.status))) return false
  const actions = s.items.flatMap((v) => (v.kind === 'action' ? [v.action] : []))
  return actions.length > 0 && actions.every((a) => a.type === 'approval' && a.subagent_id !== undefined)
}

/**
 * @param items - the conversation's views.
 * @returns the views to list, and the moved actions by subagent id.
 */
export function splitSubagentActions(items: MessageView[]): { items: MessageView[]; bySubagent: Map<string, OAIApprovalAction[]> } {
  const cards = new Set(items.flatMap((v) => (v.kind === 'subagent' ? [v.subagentId] : [])))
  const bySubagent = new Map<string, OAIApprovalAction[]>()
  const kept = items.filter((v) => {
    if (v.kind !== 'action' || v.action.type !== 'approval') return true
    const child = v.action.subagent_id
    if (child === undefined || !cards.has(child)) return true
    bySubagent.set(child, [...(bySubagent.get(child) ?? []), v.action])
    return false
  })
  return { items: bySubagent.size === 0 ? items : kept, bySubagent }
}
