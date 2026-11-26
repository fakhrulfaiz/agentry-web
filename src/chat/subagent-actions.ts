/**
 * Approvals and questions a subagent is waiting on (`approval` actions with
 * `subagent_id`) render inside that subagent's card instead of at the end of
 * the chat. One whose card is not shown (yet) stays a standalone row.
 */
import type { OAIApprovalAction } from '@/api/types'
import type { MessageView } from './reducer'

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
