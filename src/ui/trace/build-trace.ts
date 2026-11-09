/**
 * The per-turn trace: each top-level turn with the steps it took, in log
 * order, built from the same turns and items the conversation shows.
 * Pure; no I/O.
 *
 * Steps: a user message, a reasoning summary, a tool call (`function_call`,
 * `mcp_call`, `command_execution`), an assistant message, or a delegation (the
 * `subagent` call). Outputs are part of their call, not steps. A saved
 * assistant message repeats its step's reasoning in front of its text
 * (`item_reason_N` then `item_msg_N`); the label is the text after it, and a
 * message with nothing after it is not a step (the conversation shows nothing
 * for it either). Subagent turns and items are left out. Items saved before
 * their turn record is known are left out until it is.
 *
 * Items carry no timestamps, so step times stay unset; the turn record gives
 * the turn's start, end and token usage (the backend reports `usage: null`
 * today).
 */
import type { OAITokenUsage, OAITurn, StoredSessionItem } from '@/api/types'

export interface TraceStep {
  kind: 'user' | 'reasoning' | 'tool' | 'assistant' | 'subagent'
  itemId: string
  label: string
  /** Unix seconds. */
  startedAt?: number
  endedAt?: number
}

export interface TraceTurn {
  id: string
  status: string
  /** Unix seconds. */
  startedAt: number
  endedAt?: number
  usage?: OAITokenUsage
  steps: TraceStep[]
}

const LABEL_MAX = 80
const SUBAGENT_TOOL = 'subagent'
const COMMAND = 'command'

/** The first non-empty line, cut to `LABEL_MAX` characters. */
function firstLine(text: string): string {
  const line = text.split('\n').map((l) => l.trim()).find(Boolean) ?? ''
  return line.length > LABEL_MAX ? `${line.slice(0, LABEL_MAX - 1)}…` : line
}

/** Answer text without Markdown emphasis, code and heading marks. */
function plain(markdown: string): string {
  return markdown.replace(/^#+\s*/gm, '').replace(/[*_`]+/g, '')
}

function argsOf(args: Record<string, unknown> | string): Record<string, unknown> {
  if (typeof args !== 'string') return args
  try {
    const parsed = JSON.parse(args) as unknown
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {}
  } catch {
    return {}
  }
}

function reasoningText(item: StoredSessionItem | undefined): string {
  return item?.type === 'reasoning' ? (item.summary ?? []).map((p) => p.text).join('') : ''
}

function stepOf(item: StoredSessionItem, byId: Map<string, StoredSessionItem>): TraceStep | null {
  const base = { itemId: item.id }
  switch (item.type) {
    case 'message': {
      const text = item.content.map((p) => p.text).join('')
      if (item.role === 'user') return { ...base, kind: 'user', label: firstLine(text) || 'Message' }
      const prefix = reasoningText(byId.get(item.id.replace(/^item_msg_/, 'item_reason_')))
      const own = prefix && text.startsWith(prefix) ? text.slice(prefix.length) : text
      const label = firstLine(plain(own))
      return label ? { ...base, kind: 'assistant', label } : null
    }
    case 'reasoning':
      return { ...base, kind: 'reasoning', label: firstLine(reasoningText(item)) || 'Thinking' }
    case 'function_call': {
      if (item.name !== SUBAGENT_TOOL) return { ...base, kind: 'tool', label: item.name }
      const description = argsOf(item.arguments).description
      return { ...base, kind: 'subagent', label: typeof description === 'string' && description ? firstLine(description) : 'Subagent' }
    }
    case 'mcp_call':
      return { ...base, kind: 'tool', label: `${item.server_label}.${item.name}` }
    case 'command_execution':
      return { ...base, kind: 'tool', label: COMMAND }
    default:
      return null
  }
}

export function buildTrace(turns: OAITurn[], items: StoredSessionItem[]): TraceTurn[] {
  const top = items.filter((item) => !item.subagent_id)
  const byId = new Map(top.map((item) => [item.id, item]))
  const steps = new Map<string, TraceStep[]>()
  for (const item of top) {
    const step = stepOf(item, byId)
    if (!step) continue
    const list = steps.get(item.turn_id)
    if (list) list.push(step)
    else steps.set(item.turn_id, [step])
  }
  return turns
    .filter((turn) => !turn.subagent_id)
    .map((turn, index) => ({ turn, index }))
    .sort((a, b) => a.turn.created_at - b.turn.created_at || a.index - b.index)
    .map(({ turn }) => ({
      id: turn.id,
      status: turn.status,
      startedAt: turn.started_at ?? turn.created_at,
      ...(turn.completed_at ? { endedAt: turn.completed_at } : {}),
      ...(turn.usage ? { usage: turn.usage } : {}),
      steps: steps.get(turn.id) ?? [],
    }))
}
