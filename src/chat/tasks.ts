/** The chat's subagents as rows for the panel's Tasks tab. */
import type { OAIApprovalAction } from '@/api/types'
import type { MessageView, SubagentActivity } from './reducer'

export type SubagentView = Extract<MessageView, { kind: 'subagent' }>
export type TaskStatus = 'running' | 'done' | 'failed' | 'closed'

export interface TaskRow {
  id: string
  name: string
  status: TaskStatus
  model?: string
  startedAt?: number
  endedAt?: number
  /** Total tokens over the subagent's turns; undefined when none reported usage. */
  tokens?: number
  /** Approvals and questions it is waiting on. */
  waiting: number
}

function statusOf(view: SubagentView, run: SubagentActivity | undefined): TaskStatus {
  if (run?.subagent.status === 'closed') return 'closed'
  if (view.status === 'failed') return 'failed'
  if (view.status === 'completed' || view.status === 'cancelled') return 'done'
  return 'running'
}

/**
 * @param views - the conversation's views (subagent cards are picked out, in order).
 * @param runs - the subagent runs as read, for status and token usage.
 * @param actions - pending actions by subagent id.
 */
export function deriveTasks(views: MessageView[], runs: SubagentActivity[], actions: ReadonlyMap<string, OAIApprovalAction[]>): TaskRow[] {
  return views.flatMap((v): TaskRow[] => {
    if (v.kind !== 'subagent') return []
    const run = runs.find((r) => r.subagent.id === v.subagentId)
    const used = run?.turns.flatMap((t) => (t.usage ? [t.usage.total_tokens] : [])) ?? []
    return [
      {
        id: v.subagentId,
        name: v.name,
        status: statusOf(v, run),
        model: v.model,
        startedAt: v.startedAt,
        endedAt: v.endedAt,
        tokens: used.length > 0 ? used.reduce((a, b) => a + b, 0) : undefined,
        waiting: actions.get(v.subagentId)?.length ?? 0,
      },
    ]
  })
}
