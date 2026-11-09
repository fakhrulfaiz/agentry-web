/**
 * Conversation reducer: folds Agentry wire events (and, optionally, saved
 * items) into the views the chat renders. Pure functions; every update returns
 * a new state and never mutates the previous one.
 *
 * Event ids: an event with an SSE `id` is durable. It is applied once (ids
 * already in `seen`, or numerically at or below `lastEventId`, are ignored)
 * and moves `lastEventId`. An event without an `id` is ephemeral (status
 * snapshots, approval overlays, dispatch errors): it is always applied and
 * never enters `seen` or moves `lastEventId`.
 *
 * Required actions: durable status frames own `function_call` and
 * `environment_connection` actions. Approval and question actions only ever
 * travel on ephemeral frames (backend Task 6, provisional), so only an
 * ephemeral status frame adds or removes them; a replayed durable frame never
 * drops an approval that the session snapshot reported. Action views are kept
 * at the end of `items`.
 */
import type {
  OAIRequiredAction,
  OAISessionEvent,
  OAISessionItem,
  OAISessionStatusEvent,
  OAITurn,
  SessionStatus,
  StoredSessionItem,
  ToolCallStatus,
} from '@/api/types'

export type MessageView =
  | { kind: 'user'; id: string; text: string }
  | { kind: 'assistant'; id: string; text: string; streaming: boolean }
  | { kind: 'reasoning'; id: string; text: string }
  | { kind: 'tool'; id: string; callId: string; name: string; args: unknown; status: 'running' | 'done' | 'failed'; output?: unknown }
  | { kind: 'subagent'; id: string; name: string; status: string }
  | { kind: 'action'; id: string; action: OAIRequiredAction }
  | { kind: 'notice'; id: string; level: 'failed' | 'interrupted' | 'cancelled'; message: string }

export interface ConversationState {
  sessionId: string
  status: SessionStatus
  items: MessageView[]
  lastEventId: string | null
  seen: ReadonlySet<string>
}

type ToolView = Extract<MessageView, { kind: 'tool' }>
type ActionView = Extract<MessageView, { kind: 'action' }>

const LOCAL_PREFIX = 'local:'

export function initialState(sessionId: string): ConversationState {
  return { sessionId, status: 'idle', items: [], lastEventId: null, seen: new Set() }
}

/** Folds saved items (`GET .../items`, oldest first). Subagent items are skipped; event ids are untouched. */
export function applyItems(s: ConversationState, items: StoredSessionItem[]): ConversationState {
  let views = s.items
  for (const item of items) {
    if (item.subagent_id) continue
    views = applyItem(views, item, true)
  }
  return views === s.items ? s : { ...s, items: views }
}

/** Folds one wire event. `id` is the SSE `id:` line; omit it for ephemeral events. */
export function applyEvent(s: ConversationState, e: { id?: string; event: OAISessionEvent }): ConversationState {
  let next = s
  if (e.id !== undefined) {
    if (s.seen.has(e.id) || isAtOrBefore(e.id, s.lastEventId)) return s
    const seen = new Set(s.seen)
    seen.add(e.id)
    next = { ...s, seen, lastEventId: e.id }
  }
  return actionsLast(reduce(next, e.event, e.id === undefined))
}

/**
 * Pending actions always render after the conversation: an approval taken from
 * the session snapshot can arrive before the replayed history it belongs to.
 */
function actionsLast(s: ConversationState): ConversationState {
  const firstAction = s.items.findIndex((v) => v.kind === 'action')
  if (firstAction === -1 || s.items.slice(firstAction).every((v) => v.kind === 'action')) return s
  return {
    ...s,
    items: [...s.items.filter((v) => v.kind !== 'action'), ...s.items.filter((v) => v.kind === 'action')],
  }
}

/** Shows a just-sent message before the server echoes it; replaced by the server item with the same text. */
export function appendLocalUserMessage(s: ConversationState, text: string): ConversationState {
  const n = s.items.filter((v) => v.id.startsWith(LOCAL_PREFIX)).length + 1
  return { ...s, items: [...s.items, { kind: 'user', id: `${LOCAL_PREFIX}${n}`, text }] }
}

function isAtOrBefore(id: string, last: string | null): boolean {
  if (last === null) return false
  const a = Number(id)
  const b = Number(last)
  return Number.isInteger(a) && Number.isInteger(b) && a <= b
}

function reduce(s: ConversationState, event: OAISessionEvent, ephemeral: boolean): ConversationState {
  switch (event.type) {
    case 'agent.session.created':
    case 'agent.session.idle':
    case 'agent.session.in_progress':
    case 'agent.session.requires_action':
    case 'agent.session.failed':
      return applyStatus(s, event, ephemeral)
    case 'agent.session.turn.created':
    case 'agent.session.turn.in_progress':
      return event.turn.subagent_id ? { ...s, items: upsertSubagent(s.items, event.turn) } : s
    case 'agent.session.turn.completed':
    case 'agent.session.turn.failed':
    case 'agent.session.turn.cancelled':
      return applyTurnEnd(s, event.turn)
    case 'agent.session.turn.item.added':
      return { ...s, items: applyItem(s.items, event.item, false) }
    case 'agent.session.turn.item.done':
      return { ...s, items: applyItem(s.items, event.item, true) }
    case 'agent.session.turn.output_text.delta': {
      const current = find(s.items, event.item_id)
      const text = (current?.kind === 'assistant' ? current.text : '') + event.delta
      return { ...s, items: upsert(s.items, { kind: 'assistant', id: event.item_id, text, streaming: true }) }
    }
    case 'agent.session.turn.output_text.done': {
      const current = find(s.items, event.item_id)
      const streaming = current?.kind === 'assistant' ? current.streaming : true
      return { ...s, items: upsert(s.items, { kind: 'assistant', id: event.item_id, text: event.text, streaming }) }
    }
    case 'error':
      return {
        ...s,
        items: upsert(s.items, { kind: 'notice', id: `notice:${event.event_id}`, level: 'failed', message: event.error.message }),
      }
    default:
      return s
  }
}

function actionKey(action: OAIRequiredAction): string {
  switch (action.type) {
    case 'approval':
      return action.id
    case 'function_call':
      return action.call_id
    case 'environment_connection':
      return action.environment_id
  }
}

function applyStatus(s: ConversationState, event: OAISessionStatusEvent, ephemeral: boolean): ConversationState {
  const incoming = event.session.required_actions ?? []
  // Ephemeral frames carry the full action list; durable frames only the non-approval actions.
  const owned = (a: OAIRequiredAction) => ephemeral || a.type !== 'approval'
  const wanted = new Map(incoming.filter(owned).map((a) => [`action:${actionKey(a)}`, a]))

  let items = s.items.filter((v) => v.kind !== 'action' || !owned(v.action) || wanted.has(v.id))
  for (const [id, action] of wanted) {
    const view: ActionView = { kind: 'action', id, action }
    items = find(items, id) ? items.map((v) => (v.id === id ? view : v)) : [...items, view]
  }

  let status = event.session.status
  const pendingApproval = items.some((v) => v.kind === 'action' && v.action.type === 'approval')
  if (status === 'in_progress' && pendingApproval) status = 'requires_action'
  return { ...s, status, items }
}

function applyTurnEnd(s: ConversationState, turn: OAITurn): ConversationState {
  if (turn.subagent_id) return { ...s, items: upsertSubagent(s.items, turn) }
  let items = s.items.map((v) => (v.kind === 'assistant' && v.streaming ? { ...v, streaming: false } : v))
  if (turn.status === 'failed') {
    items = upsert(items, { kind: 'notice', id: `notice:${turn.id}`, level: 'failed', message: turn.error?.message ?? 'The turn failed' })
  } else if (turn.status === 'cancelled') {
    const interrupted = turn.error?.code === 'interrupted'
    items = upsert(items, {
      kind: 'notice',
      id: `notice:${turn.id}`,
      level: interrupted ? 'interrupted' : 'cancelled',
      message: interrupted ? (turn.error?.message ?? 'Interrupted') : 'Stopped',
    })
  }
  return { ...s, items }
}

function upsertSubagent(items: MessageView[], turn: OAITurn): MessageView[] {
  return upsert(items, { kind: 'subagent', id: `subagent:${turn.id}`, name: turn.subagent_id ?? 'subagent', status: turn.status })
}

function applyItem(items: MessageView[], item: OAISessionItem, done: boolean): MessageView[] {
  switch (item.type) {
    case 'message': {
      const text = item.content.map((part) => part.text).join('')
      if (item.role === 'user') return upsertUser(items, { kind: 'user', id: item.id, text })
      const current = find(items, item.id)
      const streaming = !done && item.status === 'in_progress'
      // An `item.added` for a message that already streamed keeps its text.
      const keep = current?.kind === 'assistant' && !done ? current.text : text
      return upsert(items, { kind: 'assistant', id: item.id, text: keep || text, streaming })
    }
    case 'reasoning':
      return upsert(items, { kind: 'reasoning', id: item.id, text: (item.summary ?? []).map((p) => p.text).join('') })
    case 'function_call':
      return upsertTool(items, {
        kind: 'tool',
        id: item.id,
        callId: item.call_id,
        name: item.name,
        args: parseArgs(item.arguments),
        status: toolStatus(item.status, 'running'),
      })
    case 'mcp_call':
      return upsertTool(items, {
        kind: 'tool',
        id: item.id,
        callId: item.id,
        name: `${item.server_label}.${item.name}`,
        args: item.arguments,
        status: toolStatus(item.status, 'running'),
        ...withOutput(item.error ?? item.output),
      })
    case 'command_execution':
      return upsertTool(items, {
        kind: 'tool',
        id: item.id,
        callId: item.id,
        name: 'command',
        args: item.cwd === undefined ? { command: item.command } : { command: item.command, cwd: item.cwd },
        status: toolStatus(item.status, 'running'),
        ...withOutput(item.output),
      })
    case 'function_call_output': {
      const call = items.find((v): v is ToolView => v.kind === 'tool' && v.callId === item.call_id)
      if (!call) return items
      const failed = item.status === 'failed' || item.status === 'incomplete' || Boolean(item.error)
      return upsert(items, { ...call, status: failed ? 'failed' : 'done', output: item.output })
    }
    default:
      return items
  }
}

function toolStatus(status: ToolCallStatus, inProgress: ToolView['status']): ToolView['status'] {
  if (status === 'completed') return 'done'
  if (status === 'in_progress') return inProgress
  return 'failed'
}

function withOutput(output: unknown): { output?: unknown } {
  return output === undefined || output === null ? {} : { output }
}

function parseArgs(args: Record<string, unknown> | string): unknown {
  if (typeof args !== 'string') return args
  try {
    return JSON.parse(args) as unknown
  } catch {
    return args
  }
}

/** A re-sent call item never regresses a finished tool or drops its output. */
function upsertTool(items: MessageView[], view: ToolView): MessageView[] {
  const current = find(items, view.id)
  if (current?.kind === 'tool' && current.status !== 'running') {
    return upsert(items, { ...view, status: current.status, ...withOutput(current.output ?? view.output) })
  }
  return upsert(items, view)
}

function upsertUser(items: MessageView[], view: Extract<MessageView, { kind: 'user' }>): MessageView[] {
  if (find(items, view.id)) return upsert(items, view)
  const local = items.find((v) => v.kind === 'user' && v.id.startsWith(LOCAL_PREFIX) && v.text === view.text)
  if (local) return items.map((v) => (v === local ? view : v))
  return [...items, view]
}

function find(items: MessageView[], id: string): MessageView | undefined {
  return items.find((v) => v.id === id)
}

function upsert(items: MessageView[], view: MessageView): MessageView[] {
  const index = items.findIndex((v) => v.id === view.id)
  if (index === -1) return [...items, view]
  const copy = items.slice()
  copy[index] = view
  return copy
}

/** Drops the latest optimistic message with this text (its send failed). */
export function removeLocalUserMessage(s: ConversationState, text: string): ConversationState {
  const index = s.items.findLastIndex((v) => v.kind === 'user' && v.id.startsWith(LOCAL_PREFIX) && v.text === text)
  if (index === -1) return s
  return { ...s, items: [...s.items.slice(0, index), ...s.items.slice(index + 1)] }
}
