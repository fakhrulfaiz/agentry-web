import type { OAITurn } from '@/api/types'
import type { MessageView } from '@/chat/reducer'

/** A top-level row: one view, or a finished turn's process rows folded into one summary. */
export type ChatEntry = { type: 'view'; view: MessageView } | { type: 'group'; turnId: string; views: MessageView[]; thinking: boolean; commands: number; edits: number; subagents: number; tools: number; steps: number; seconds?: number }

const FINISHED = new Set<OAITurn['status']>(['completed', 'failed', 'cancelled'])

/** Rows that belong to the process of a turn (everything but the final answer, files, commands, notices and actions). */
function isProcess(v: MessageView): boolean {
  // A failed tool call stays visible as its own row; it is never folded away.
  return v.kind === 'reasoning' || (v.kind === 'tool' && v.status !== 'failed') || v.kind === 'subagent' || (v.kind === 'assistant' && v.text.trim() !== '')
}

const COMMANDS = new Set(['command', 'bash', 'shell', 'sandbox_exec', 'run_code'])
const EDITS = new Set(['write', 'edit', 'multi_edit', 'apply_patch', 'sandbox_push'])
const toolsOf = (views: MessageView[], names: Set<string>) => views.filter((v) => v.kind === 'tool' && names.has(v.name)).length

function isRunning(v: MessageView): boolean {
  return (
    ((v.kind === 'assistant' || v.kind === 'reasoning') && v.streaming) ||
    (v.kind === 'tool' && v.status === 'running') ||
    (v.kind === 'subagent' && (v.status === 'running' || v.status === 'in_progress' || v.endedAt === undefined))
  )
}

/**
 * Folds each finished turn's reasoning, tool calls and interim assistant text into one group placed where the
 * first of them was; the turn's last assistant text stays outside, after it. A turn that is still open, has a
 * running row, or has a pending action is left as it is.
 */
export function groupTurns(items: MessageView[], turnOf: ReadonlyMap<string, string>, turns: OAITurn[]): ChatEntry[] {
  const turnById = new Map(turns.map((t) => [t.id, t]))
  const byTurn = new Map<string, MessageView[]>()
  for (const v of items) {
    const id = turnOf.get(v.id)
    if (id && v.kind !== 'user') byTurn.set(id, [...(byTurn.get(id) ?? []), v])
  }
  const grouped = new Map<string, { views: MessageView[]; first: MessageView }>()
  for (const [id, views] of byTurn) {
    const turn = turnById.get(id)
    if (!turn || !FINISHED.has(turn.status)) continue
    if (views.some((v) => isRunning(v) || v.kind === 'action')) continue
    const lastAnswer = views.findLast((v) => v.kind === 'assistant' && v.text.trim() !== '')
    const process = views.filter((v) => isProcess(v) && v !== lastAnswer)
    const steps = process.filter((v) => v.kind !== 'assistant')
    // One quick tool call and nothing else is just that line, not a block.
    const single = steps.length === 1 && steps[0]!.kind === 'tool' && process.length === 1
    if (steps.length > 0 && !single && process[0]) grouped.set(id, { views: process, first: process[0] })
  }
  const out: ChatEntry[] = []
  for (const v of items) {
    const id = turnOf.get(v.id)
    const g = id ? grouped.get(id) : undefined
    if (!g || !id || !g.views.includes(v)) {
      out.push({ type: 'view', view: v })
      continue
    }
    if (v !== g.first) continue
    const turn = turnById.get(id)
    const start = turn?.started_at ?? turn?.created_at
    const end = turn?.completed_at
    out.push({
      type: 'group',
      turnId: id,
      views: g.views,
      thinking: g.views.some((x) => x.kind === 'reasoning'),
      commands: toolsOf(g.views, COMMANDS),
      edits: toolsOf(g.views, EDITS),
      subagents: g.views.filter((x) => x.kind === 'subagent').length,
      tools: g.views.filter((x) => x.kind === 'tool' && !COMMANDS.has(x.name) && !EDITS.has(x.name)).length,
      steps: g.views.filter((x) => x.kind !== 'assistant').length,
      ...(typeof start === 'number' && typeof end === 'number' && end >= start ? { seconds: end - start } : {}),
    })
  }
  return out
}

/** "2m 5s" / "40s"; under a second is "1s". */
export function formatDuration(seconds: number): string {
  const s = Math.max(1, Math.round(seconds))
  const m = Math.floor(s / 60)
  return m === 0 ? `${s}s` : `${m}m${s % 60 ? ` ${s % 60}s` : ''}`
}
