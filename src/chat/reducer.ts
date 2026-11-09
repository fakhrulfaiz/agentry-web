/**
 * Conversation reducer: folds Agentry wire events and saved items into the
 * views the chat renders. Pure functions; every update returns a new state and
 * never mutates the previous one.
 *
 * Event ids: an event with an SSE `id` is durable. It is applied once (ids
 * already in `seen`, or numerically at or below `lastEventId`, are ignored)
 * and moves `lastEventId`. An event without an `id` is ephemeral (status
 * snapshots, approval overlays, dispatch errors): it is always applied and
 * never enters `seen` or moves `lastEventId`.
 *
 * History then replay (ruling R14): the hook folds `GET /items` first and then
 * replays the stream from `Last-Event-ID: 0`. Item ids are deterministic and
 * shared by `/items` and the stream, so every view is upserted by id: a
 * replayed event for a view the items already created updates it in place.
 * A finished assistant message ignores replayed `item.added` and deltas, so its
 * text is never doubled.
 *
 * Order: each view remembers its turn (`turnOf`). A new view is inserted after
 * the last view of the same turn, so a replayed notice or delegation card for
 * an old turn lands inside that turn, not at the bottom. Views without a turn
 * are appended.
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
  /** View id → turn id, for chronological insertion. */
  turnOf: ReadonlyMap<string, string>
  /** The open top-level turn, if any. */
  openTurn: string | null
}

type ToolView = Extract<MessageView, { kind: 'tool' }>
type ActionView = Extract<MessageView, { kind: 'action' }>
type UserView = Extract<MessageView, { kind: 'user' }>

const LOCAL_PREFIX = 'local:'

export function initialState(sessionId: string): ConversationState {
  return { sessionId, status: 'idle', items: [], lastEventId: null, seen: new Set(), turnOf: new Map(), openTurn: null }
}

/** Folds saved items (`GET .../items`, oldest first). Subagent items are skipped; event ids are untouched. */
export function applyItems(s: ConversationState, items: StoredSessionItem[]): ConversationState {
  let next = s
  for (const item of items) {
    if (item.subagent_id) continue
    next = applyItem(next, item, true)
  }
  return actionsLast(next)
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
 * Shows a just-sent message before the server echoes it; replaced by the
 * server item with the same text. Sent during a turn, it belongs to that turn
 * (steering), so later replies of the turn follow it.
 */
export function appendLocalUserMessage(s: ConversationState, text: string): ConversationState {
  const n = s.items.filter((v) => v.id.startsWith(LOCAL_PREFIX)).length + 1
  return place(s, { kind: 'user', id: `${LOCAL_PREFIX}${n}`, text }, s.openTurn ?? undefined, true)
}

/** Drops the latest optimistic message with this text (its send failed). */
export function removeLocalUserMessage(s: ConversationState, text: string): ConversationState {
  const index = s.items.findLastIndex((v) => v.kind === 'user' && v.id.startsWith(LOCAL_PREFIX) && v.text === text)
  if (index === -1) return s
  return { ...s, items: [...s.items.slice(0, index), ...s.items.slice(index + 1)] }
}

/**
 * Pending actions always render after the conversation: an approval taken from
 * the session snapshot can arrive before the history it belongs to.
 */
function actionsLast(s: ConversationState): ConversationState {
  const firstAction = s.items.findIndex((v) => v.kind === 'action')
  if (firstAction === -1 || s.items.slice(firstAction).every((v) => v.kind === 'action')) return s
  return {
    ...s,
    items: [...s.items.filter((v) => v.kind !== 'action'), ...s.items.filter((v) => v.kind === 'action')],
  }
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
      return event.turn.subagent_id ? placeSubagent(s, event.turn) : { ...s, openTurn: event.turn.id }
    case 'agent.session.turn.completed':
    case 'agent.session.turn.failed':
    case 'agent.session.turn.cancelled':
      return applyTurnEnd(s, event.turn)
    case 'agent.session.turn.item.added':
      return applyItem(s, event.item, false, event.turn_id)
    case 'agent.session.turn.item.done':
      return applyItem(s, event.item, true, event.turn_id)
    case 'agent.session.turn.output_text.delta': {
      const current = find(s.items, event.item_id)
      if (current?.kind === 'assistant' && !current.streaming) return s // replay of a finished message
      const text = (current?.kind === 'assistant' ? current.text : '') + event.delta
      return place(s, { kind: 'assistant', id: event.item_id, text, streaming: true }, event.turn_id)
    }
    case 'agent.session.turn.output_text.done': {
      const current = find(s.items, event.item_id)
      const streaming = current?.kind === 'assistant' ? current.streaming : true
      return place(s, { kind: 'assistant', id: event.item_id, text: event.text, streaming }, event.turn_id)
    }
    case 'error':
      return place(s, { kind: 'notice', id: `notice:${event.event_id}`, level: 'failed', message: event.error.message }, undefined)
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
  if (turn.subagent_id) return placeSubagent(s, turn)
  let next: ConversationState = {
    ...s,
    openTurn: s.openTurn === turn.id ? null : s.openTurn,
    items: s.items.map((v) => (v.kind === 'assistant' && v.streaming ? { ...v, streaming: false } : v)),
  }
  if (turn.status === 'failed') {
    next = place(next, { kind: 'notice', id: `notice:${turn.id}`, level: 'failed', message: turn.error?.message ?? 'The turn failed' }, turn.id)
  } else if (turn.status === 'cancelled') {
    const interrupted = turn.error?.code === 'interrupted'
    next = place(next, {
      kind: 'notice',
      id: `notice:${turn.id}`,
      level: interrupted ? 'interrupted' : 'cancelled',
      message: interrupted ? (turn.error?.message ?? 'Interrupted') : 'Stopped',
    }, turn.id)
  }
  return next
}

/** A subagent turn carries no parent turn id; it belongs to the open top-level turn. */
function placeSubagent(s: ConversationState, turn: OAITurn): ConversationState {
  const id = `subagent:${turn.id}`
  const parent = s.turnOf.get(id) ?? s.openTurn ?? undefined
  return place(s, { kind: 'subagent', id, name: turn.subagent_id ?? 'subagent', status: turn.status }, parent)
}

function applyItem(s: ConversationState, item: OAISessionItem, done: boolean, eventTurn?: string): ConversationState {
  const turn = item.turn_id || eventTurn
  switch (item.type) {
    case 'message': {
      const text = item.content.map((part) => part.text).join('')
      if (item.role === 'user') return placeUser(s, { kind: 'user', id: item.id, text }, turn)
      const current = find(s.items, item.id)
      if (!done && current?.kind === 'assistant') {
        // `item.added` for a message we already show (streamed, or loaded from items): keep it as is.
        return current.streaming || !text ? s : place(s, { ...current, text }, turn)
      }
      return place(s, { kind: 'assistant', id: item.id, text, streaming: !done && item.status === 'in_progress' }, turn)
    }
    case 'reasoning':
      return place(s, { kind: 'reasoning', id: item.id, text: (item.summary ?? []).map((p) => p.text).join('') }, turn)
    case 'function_call':
      return placeTool(s, {
        kind: 'tool',
        id: item.id,
        callId: item.call_id,
        name: item.name,
        args: parseArgs(item.arguments),
        status: toolStatus(item.status, 'running'),
      }, turn)
    case 'mcp_call':
      return placeTool(s, {
        kind: 'tool',
        id: item.id,
        callId: item.id,
        name: `${item.server_label}.${item.name}`,
        args: item.arguments,
        status: toolStatus(item.status, 'running'),
        ...withOutput(item.error ?? item.output),
      }, turn)
    case 'command_execution':
      return placeTool(s, {
        kind: 'tool',
        id: item.id,
        callId: item.id,
        name: 'command',
        args: item.cwd === undefined ? { command: item.command } : { command: item.command, cwd: item.cwd },
        status: toolStatus(item.status, 'running'),
        ...withOutput(item.output),
      }, turn)
    case 'function_call_output': {
      const call = s.items.find((v): v is ToolView => v.kind === 'tool' && v.callId === item.call_id)
      if (!call) return s
      const failed = item.status === 'failed' || item.status === 'incomplete' || Boolean(item.error)
      return place(s, { ...call, status: failed ? 'failed' : 'done', output: item.output }, turn)
    }
    default:
      return s
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
function placeTool(s: ConversationState, view: ToolView, turn: string | undefined): ConversationState {
  const current = find(s.items, view.id)
  if (current?.kind === 'tool' && current.status !== 'running') {
    return place(s, { ...view, status: current.status, ...withOutput(current.output ?? view.output) }, turn)
  }
  return place(s, view, turn)
}

/** A server user message replaces the optimistic one with the same text, in its position. */
function placeUser(s: ConversationState, view: UserView, turn: string | undefined): ConversationState {
  if (find(s.items, view.id)) return place(s, view, turn)
  const local = s.items.find((v) => v.kind === 'user' && v.id.startsWith(LOCAL_PREFIX) && v.text === view.text)
  if (!local) return place(s, view, turn)
  const turnOf = new Map(s.turnOf)
  turnOf.delete(local.id)
  if (turn) turnOf.set(view.id, turn)
  return { ...s, turnOf, items: s.items.map((v) => (v === local ? view : v)) }
}

function find(items: MessageView[], id: string): MessageView | undefined {
  return items.find((v) => v.id === id)
}

/**
 * Upserts `view` by id. An existing view is replaced in place. A new one goes
 * right after the last view of `turn` (or at the end without a turn, or when
 * `append`).
 */
function place(s: ConversationState, view: MessageView, turn: string | undefined, append = false): ConversationState {
  const index = s.items.findIndex((v) => v.id === view.id)
  const turnOf = turn && !s.turnOf.has(view.id) ? new Map(s.turnOf).set(view.id, turn) : s.turnOf
  if (index !== -1) {
    const items = s.items.slice()
    items[index] = view
    return { ...s, items, turnOf }
  }
  let at = s.items.length
  if (turn && !append) {
    const last = s.items.findLastIndex((v) => s.turnOf.get(v.id) === turn)
    if (last !== -1) at = last + 1
  }
  return { ...s, items: [...s.items.slice(0, at), view, ...s.items.slice(at)], turnOf }
}
