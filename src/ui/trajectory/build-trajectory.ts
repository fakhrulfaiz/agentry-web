/**
 * The trajectory of a chat: what the agent did, turn by turn, as ledger
 * records (User, Assistant step, Tool, and Subtool for a subagent's own
 * activity under the call that delegated to it). Pure; no I/O.
 *
 * Built from what Agentry exposes: turn records (`GET /turns`: status, start
 * and end in Unix seconds, token usage), saved items (`GET /items`) and
 * subagents with their turns and items. Saved items carry no timestamps, so a
 * record has timing only when its source has it: a turn, or a subagent run
 * (its turns). Nothing is invented: missing timing stays undefined.
 *
 * Assistant steps: the backend saves a step as `item_reason_N` (thinking) and
 * `item_msg_N` (text, which repeats the thinking first). They form one
 * Assistant record "Step k" (k counts steps in the turn). Tool calls belong to
 * the step before them (`stepId`), which is what the Calls fold groups.
 *
 * Status: a tool call is completed or failed once its output arrives; without
 * output it is pending while its turn runs, and settles with the turn
 * (completed, failed when the turn failed, cancelled when it was stopped).
 * Steps are pending while their turn runs; the last step of a failed or
 * cancelled turn takes that status.
 */
import type { OAISubagent, OAITokenUsage, OAITurn, StoredSessionItem, TurnStatus } from '@/api/types'
import { stripReasoning } from '@/chat/reducer'

export type RecordKind = 'user' | 'assistant' | 'tool' | 'subtool'
export type RecordStatus = 'pending' | 'completed' | 'failed' | 'cancelled'

export interface TrajectoryRecord {
  /** Unique within the trajectory. */
  id: string
  kind: RecordKind
  /** For a subtool: what it is inside the subagent. */
  subKind?: Exclude<RecordKind, 'subtool'>
  /** The conversation row that shows it (a subtool shows in its delegating call). */
  chatItemId: string
  turnId: string | null
  status: RecordStatus
  /** One-line preview. */
  title: string
  /** Assistant step number within its turn. */
  step?: number
  /** Tool name as recorded. */
  name?: string
  /** User text, or tool arguments. */
  input?: unknown
  /** Assistant text, or tool output. */
  output?: unknown
  thinking?: string
  model?: string
  /** Unix seconds; only when recorded. */
  startedAt?: number
  endedAt?: number
  usage?: OAITokenUsage
  /** The Assistant step a tool call belongs to. */
  stepId?: string
  /** A subagent's activity under the call that delegated to it. */
  subcalls?: TrajectoryRecord[]
  subagentId?: string
}

export interface TrajectoryTurn {
  id: string
  /** 1-based, in order. */
  index: number
  status: TurnStatus
  startedAt: number
  endedAt?: number
  usage?: OAITokenUsage
  records: TrajectoryRecord[]
}

export interface Trajectory {
  turns: TrajectoryTurn[]
  /** Records whose turn is not (yet) known. */
  between: TrajectoryRecord[]
}

/** One subagent with its turns and, once loaded, its items. */
export interface SubagentRun {
  subagent: OAISubagent
  turns: OAITurn[]
  items?: StoredSessionItem[]
}

const TERMINAL = new Set<TurnStatus>(['completed', 'failed', 'cancelled'])
const PREVIEW_MAX = 120
const SUBAGENT_TOOL = 'subagent'
const COMMAND = 'command'

export function firstLine(text: string, max = PREVIEW_MAX): string {
  const line = text.split('\n').map((l) => l.trim()).find(Boolean) ?? ''
  return line.length > max ? `${line.slice(0, max - 1)}…` : line
}

/** Text without Markdown emphasis, code and heading marks (for previews). */
function plain(markdown: string): string {
  return markdown.replace(/^#+\s*/gm, '').replace(/[*_`]+/g, '')
}

export function parseArgs(args: unknown): unknown {
  if (typeof args !== 'string') return args
  try {
    return JSON.parse(args) as unknown
  } catch {
    return args
  }
}

/** A one-line hint of tool arguments: the first string value, else the first string list, else compact JSON. */
export function argumentSummary(args: unknown): string {
  const source = parseArgs(args)
  let text: string
  if (source && typeof source === 'object' && !Array.isArray(source)) {
    const values = Object.values(source as Record<string, unknown>)
    const first = values.find((v) => typeof v === 'string')
    const list = values.find((v): v is string[] => Array.isArray(v) && v.length > 0 && v.every((x) => typeof x === 'string'))
    text = typeof first === 'string' ? first : list ? list.join(', ') : JSON.stringify(source)
  } else {
    text = typeof source === 'string' ? source : (JSON.stringify(source) ?? '')
  }
  return firstLine(text.replace(/\s+/g, ' '), 80)
}

interface Scope {
  /** Prefix for record ids (a subagent's items reuse the parent's item ids). */
  prefix: string
  /** Subtool records point at this chat row; otherwise each record at its own item. */
  chatItemId?: string
  turnStatus(turnId: string): TurnStatus | undefined
  model?: string
}

function stepNumberOf(id: string): string | null {
  const m = /^item_(?:reason|msg)_(\d+)$/.exec(id)
  return m ? m[1] : null
}

/** Records of one item list (top level or one subagent), in log order. */
function recordsOf(items: StoredSessionItem[], scope: Scope): TrajectoryRecord[] {
  const out: TrajectoryRecord[] = []
  const steps = new Map<string, TrajectoryRecord>()
  const stepCount = new Map<string, number>()
  const lastStep = new Map<string, TrajectoryRecord>()
  const reasoningText = new Map<string, string>()
  const calls = new Map<string, TrajectoryRecord>()
  const sub = scope.chatItemId !== undefined

  const make = (kind: Exclude<RecordKind, 'subtool'>, itemId: string, turnId: string, fields: Partial<TrajectoryRecord>): TrajectoryRecord => ({
    id: `${scope.prefix}${itemId}`,
    kind: sub ? 'subtool' : kind,
    ...(sub ? { subKind: kind } : {}),
    chatItemId: scope.chatItemId ?? itemId,
    turnId: turnId || null,
    status: 'pending',
    title: '',
    ...fields,
  })

  const stepFor = (itemId: string, turnId: string): TrajectoryRecord => {
    const n = stepNumberOf(itemId)
    const key = `${turnId}:${n ?? itemId}`
    const existing = steps.get(key)
    if (existing) return existing
    const count = (stepCount.get(turnId) ?? 0) + 1
    stepCount.set(turnId, count)
    const record = make('assistant', itemId, turnId, { step: count, title: '', ...(scope.model ? { model: scope.model } : {}) })
    steps.set(key, record)
    lastStep.set(turnId, record)
    out.push(record)
    return record
  }

  for (const item of items) {
    // A command result is human-only output, not a step of the agent's work.
    if (item.type === 'slash_command') continue
    const turnId = item.turn_id
    switch (item.type) {
      case 'message': {
        const text = item.content.map((p) => p.text).join('')
        if (item.role === 'user') {
          out.push(make('user', item.id, turnId, { title: firstLine(text) || 'Message', input: text }))
          break
        }
        const step = stepFor(item.id, turnId)
        const n = stepNumberOf(item.id)
        const prefix = n ? (reasoningText.get(`${turnId}:${n}`) ?? '') : ''
        const own = stripReasoning(text, prefix)
        step.output = own
        if (own.trim()) {
          step.title = firstLine(plain(own))
          if (!sub) step.chatItemId = item.id
        }
        break
      }
      case 'reasoning': {
        const text = (item.summary ?? []).map((p) => p.text).join('')
        const n = stepNumberOf(item.id)
        if (n) reasoningText.set(`${turnId}:${n}`, text)
        const step = stepFor(item.id, turnId)
        step.thinking = (step.thinking ? `${step.thinking}\n\n` : '') + text
        break
      }
      case 'function_call':
      case 'mcp_call':
      case 'command_execution': {
        const name = item.type === 'function_call' ? item.name : item.type === 'mcp_call' ? `${item.server_label}.${item.name}` : COMMAND
        const input = item.type === 'command_execution' ? { command: item.command, ...(item.cwd === undefined ? {} : { cwd: item.cwd }) } : parseArgs(item.arguments)
        const step = lastStep.get(turnId)
        const record = make('tool', item.id, turnId, { name, input, title: argumentSummary(input), ...(step ? { stepId: step.id } : {}) })
        if (item.type !== 'function_call') {
          const output = item.type === 'mcp_call' ? (item.error ?? item.output) : item.output
          if (output !== undefined && output !== null) record.output = output
          if (item.status === 'completed') record.status = 'completed'
          else if (item.status === 'failed' || item.status === 'incomplete' || (item.type === 'mcp_call' && item.error)) record.status = 'failed'
        }
        calls.set(item.type === 'function_call' ? item.call_id : item.id, record)
        out.push(record)
        break
      }
      case 'function_call_output': {
        // A shell command's output carries a call id its command item lacks: it finishes the latest command without output.
        const call =
          calls.get(item.call_id) ??
          out.findLast((r) => r.name === COMMAND && r.output === undefined && r.turnId === (turnId || null))
        if (!call) break
        call.output = item.output
        call.status = item.status === 'failed' || item.status === 'incomplete' || item.error ? 'failed' : 'completed'
        break
      }
    }
  }

  // Settle what the turn's end decides. A user message is received once saved.
  for (const record of out) {
    const kind = record.subKind ?? record.kind
    const status = record.turnId ? scope.turnStatus(record.turnId) : undefined
    if (kind === 'user') record.status = 'completed'
    else if (record.status === 'pending' && status && TERMINAL.has(status)) {
      const last = kind === 'tool' || lastStep.get(record.turnId ?? '') === record
      record.status = last && (status === 'failed' || status === 'cancelled') ? status : 'completed'
    }
    if (kind === 'assistant' && !record.title && record.thinking) record.title = firstLine(plain(record.thinking))
  }
  return out
}

function runStatus(run: SubagentRun): RecordStatus {
  const last = run.turns.at(-1)
  if (!last) return run.subagent.status === 'closed' ? 'completed' : 'pending'
  if (last.status === 'failed' || last.status === 'cancelled') return last.status
  return TERMINAL.has(last.status) ? 'completed' : 'pending'
}

export function buildTrajectory(turns: OAITurn[], items: StoredSessionItem[], subagents: SubagentRun[] = [], options: { model?: string } = {}): Trajectory {
  const top = turns.filter((t) => !t.subagent_id)
  const statusOf = new Map(top.map((t) => [t.id, t.status]))
  const records = recordsOf(
    items.filter((i) => !i.subagent_id),
    { prefix: '', turnStatus: (id) => statusOf.get(id), ...(options.model ? { model: options.model } : {}) },
  )

  // Subagent activity nests under the call that started it ("started subagent <id>").
  for (const record of records) {
    if (record.kind !== 'tool' || record.name !== SUBAGENT_TOOL || typeof record.output !== 'string') continue
    const run = subagents.find((r) => (record.output as string).includes(r.subagent.id))
    const description = record.input && typeof record.input === 'object' ? (record.input as { description?: unknown }).description : undefined
    if (typeof description === 'string' && description) record.title = firstLine(description, 80)
    if (!run) continue
    const childStatus = new Map(run.turns.map((t) => [t.id, t.status]))
    record.subagentId = run.subagent.id
    record.subcalls = recordsOf(
      (run.items ?? []).map(({ subagent_id: _child, ...item }) => item as StoredSessionItem),
      { prefix: `${run.subagent.id}/`, chatItemId: record.chatItemId, turnStatus: (id) => childStatus.get(id) },
    )
    const first = run.turns[0]
    const last = run.turns.at(-1)
    const start = first?.started_at ?? first?.created_at
    if (start) record.startedAt = start
    const status = runStatus(run)
    const end = status === 'pending' ? undefined : (last?.completed_at ?? run.subagent.closed_at)
    if (end) record.endedAt = end
    // The call's own status follows the run it started.
    record.status = status
  }

  const byTurn = new Map<string, TrajectoryRecord[]>()
  const between: TrajectoryRecord[] = []
  for (const record of records) {
    if (record.turnId && statusOf.has(record.turnId)) {
      const list = byTurn.get(record.turnId)
      if (list) list.push(record)
      else byTurn.set(record.turnId, [record])
    } else between.push(record)
  }
  const ordered = top
    .map((turn, i) => ({ turn, i }))
    .sort((a, b) => a.turn.created_at - b.turn.created_at || a.i - b.i)
    .map(({ turn }, index): TrajectoryTurn => ({
      id: turn.id,
      index: index + 1,
      status: turn.status,
      startedAt: turn.started_at ?? turn.created_at,
      ...(turn.completed_at ? { endedAt: turn.completed_at } : {}),
      ...(turn.usage ? { usage: turn.usage } : {}),
      records: byTurn.get(turn.id) ?? [],
    }))
  return { turns: ordered, between }
}

/** Every record, depth first (subcalls after their call). */
export function allRecords(t: Trajectory): TrajectoryRecord[] {
  const out: TrajectoryRecord[] = []
  const walk = (list: TrajectoryRecord[]) => {
    for (const r of list) {
      out.push(r)
      if (r.subcalls) walk(r.subcalls)
    }
  }
  for (const turn of t.turns) walk(turn.records)
  walk(t.between)
  return out
}

const KIND_WORD: Record<RecordKind, string> = { user: 'user', assistant: 'assistant', tool: 'tool', subtool: 'subtool' }

function textOf(value: unknown): string {
  if (value === undefined || value === null) return ''
  return typeof value === 'string' ? value : (JSON.stringify(value) ?? '')
}

/** Record ids matching `query` (case-insensitive, in kind, name, preview, input, output and thinking), subcalls included. */
export function searchRecords(t: Trajectory, query: string): Set<string> {
  const q = query.trim().toLowerCase()
  const hits = new Set<string>()
  if (!q) return hits
  for (const r of allRecords(t)) {
    const haystack = [KIND_WORD[r.kind], r.subKind ?? '', r.name ?? '', r.title, textOf(r.input), textOf(r.output), r.thinking ?? ''].join('\n').toLowerCase()
    if (haystack.includes(q)) hits.add(r.id)
  }
  return hits
}

/**
 * Record ids active at any point in [from, to] (Unix seconds, inclusive): a
 * record with its own timing by its span; any other by its turn's span.
 */
export function recordsInInterval(t: Trajectory, from: number, to: number, now: number): Set<string> {
  const hits = new Set<string>()
  const overlaps = (start: number, end: number) => start <= to && end >= from
  const visit = (list: TrajectoryRecord[], turnSpan: [number, number] | null) => {
    for (const r of list) {
      const own: [number, number] | null = r.startedAt !== undefined ? [r.startedAt, r.endedAt ?? now] : null
      const span = own ?? turnSpan
      if (span && overlaps(span[0], span[1])) hits.add(r.id)
      if (r.subcalls) visit(r.subcalls, own ?? turnSpan)
    }
  }
  for (const turn of t.turns) visit(turn.records, [turn.startedAt, turn.endedAt ?? now])
  return hits
}

export interface TimelineSpan {
  id: string
  lane: 'turn' | 'subagent'
  label: string
  start: number
  /** Undefined while still running. */
  end?: number
  status: RecordStatus
}

/** A turn's status as a record status (pending until it ends). */
export function turnRecordStatus(status: TurnStatus): RecordStatus {
  if (status === 'failed' || status === 'cancelled') return status
  return TERMINAL.has(status) ? 'completed' : 'pending'
}

/** The spans the overview draws: turns and subagent runs, from recorded timing only. */
export function timelineSpans(t: Trajectory): TimelineSpan[] {
  const spans: TimelineSpan[] = []
  for (const turn of t.turns) {
    spans.push({
      id: turn.id,
      lane: 'turn',
      label: `Turn ${turn.index}`,
      start: turn.startedAt,
      ...(turn.endedAt !== undefined ? { end: turn.endedAt } : {}),
      status: turnRecordStatus(turn.status),
    })
    for (const r of turn.records) {
      if (r.subagentId && r.startedAt !== undefined) {
        spans.push({ id: r.id, lane: 'subagent', label: r.title || 'Subagent', start: r.startedAt, ...(r.endedAt !== undefined ? { end: r.endedAt } : {}), status: r.status })
      }
    }
  }
  return spans
}
