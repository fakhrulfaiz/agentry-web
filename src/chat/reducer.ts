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
 * What the backend really streams (fixture `tests/fixtures/live/web-search.json`):
 * status, turn, and assistant-message frames only. User messages, reasoning,
 * function calls and their outputs exist only in `GET /items`, so the hook
 * refreshes the items during a turn and `applyItems` merges them in log order
 * around the streamed messages. A saved assistant message repeats its step's
 * reasoning in front of its own text (`item_reason_N` then `item_msg_N`, same
 * N), and a step without text streams that reasoning as its text: the
 * reasoning is cut from the front of the message whenever both are known.
 *
 * Streaming: an assistant message streams from its first delta until its turn
 * ends; reasoning that arrives while its turn is open streams until then too.
 *
 * Subagents: a child's activity never travels on the parent stream. The hook
 * reads `GET .../subagents` and each child's turns, and `applySubagents` makes
 * one card per child, right after the `subagent` call whose output names it
 * ("started subagent <id>"), named by that call's `description`.
 *
 * Turns and the log (for the trace): `turns` holds each top-level turn record,
 * from the stream's turn frames and `GET .../turns` (`applyTurns`); a finished
 * turn never goes back to running when its `created` frame is replayed. `log`
 * is the latest `GET .../items` list as fetched.
 *
 * Tool calls: the backend leaves a `function_call` `in_progress` until its
 * output item arrives. A call still without output when its turn has ended is
 * shown done (or failed, when the turn failed), so it never keeps spinning; an
 * output that arrives later still fills it in.
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
  OAISubagent,
  OAITurn,
  SessionStatus,
  StoredSessionItem,
  ToolCallStatus,
} from '@/api/types'

export type MessageView =
  | { kind: 'user'; id: string; text: string }
  | { kind: 'assistant'; id: string; text: string; streaming: boolean }
  | { kind: 'reasoning'; id: string; text: string; streaming: boolean }
  | { kind: 'tool'; id: string; callId: string; name: string; args: unknown; status: 'running' | 'done' | 'failed'; output?: unknown }
  | {
    kind: 'subagent'
    id: string
    /** The parent session (the one whose `/subagents/{subagentId}` routes hold the child). */
    sessionId: string
    subagentId: string
    name: string
    status: string
    /** Unix seconds. */
    startedAt?: number
    endedAt?: number
  }
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
  /** Top-level turn records, oldest first. */
  turns: OAITurn[]
  /** The latest saved-items list (`GET .../items`). */
  log: StoredSessionItem[]
}

type ToolView = Extract<MessageView, { kind: 'tool' }>
type ActionView = Extract<MessageView, { kind: 'action' }>
type UserView = Extract<MessageView, { kind: 'user' }>
type AssistantView = Extract<MessageView, { kind: 'assistant' }>
type ReasoningView = Extract<MessageView, { kind: 'reasoning' }>
type SubagentView = Extract<MessageView, { kind: 'subagent' }>

/** One subagent with its turns, as the hook reads them. */
export interface SubagentActivity {
  subagent: OAISubagent
  turns: OAITurn[]
}

const LOCAL_PREFIX = 'local:'

export function initialState(sessionId: string): ConversationState {
  return { sessionId, status: 'idle', items: [], lastEventId: null, seen: new Set(), turnOf: new Map(), openTurn: null, turns: [], log: [] }
}

/**
 * Folds saved items (`GET .../items`, oldest first; the whole list, or the
 * part saved so far). Subagent items are skipped; event ids are untouched.
 * Afterwards the views follow the log order (see `inLogOrder`).
 */
export function applyItems(s: ConversationState, items: StoredSessionItem[]): ConversationState {
  let next: ConversationState = { ...s, log: items }
  const top = items.filter((item) => !item.subagent_id)
  for (const item of top) next = applyItem(next, item, true)
  return actionsLast(inLogOrder(next, top))
}

/** Upserts top-level turn records (`GET .../turns`); subagent turns are skipped. */
export function applyTurns(s: ConversationState, turns: OAITurn[]): ConversationState {
  let next = s
  for (const turn of turns) next = upsertTurn(next, turn)
  return next
}

const TERMINAL_TURN = new Set<OAITurn['status']>(['completed', 'failed', 'cancelled'])

/**
 * Upserts one top-level turn record; a finished record is never replaced by an
 * unfinished one. A finished turn settles its tool calls that have no output.
 */
function upsertTurn(s: ConversationState, turn: OAITurn): ConversationState {
  if (turn.subagent_id) return s
  const index = s.turns.findIndex((t) => t.id === turn.id)
  const current = index === -1 ? undefined : s.turns[index]
  if (current && TERMINAL_TURN.has(current.status) && !TERMINAL_TURN.has(turn.status)) return s
  const turns = index === -1 ? [...s.turns, turn] : s.turns.with(index, turn)
  const next = { ...s, turns }
  if (!TERMINAL_TURN.has(turn.status)) return next
  const ended = endedToolStatus(turn.status)
  let changed = false
  const items = next.items.map((v) => {
    if (v.kind !== 'tool' || v.status !== 'running' || v.output !== undefined || next.turnOf.get(v.id) !== turn.id) return v
    changed = true
    return { ...v, status: ended }
  })
  return changed ? { ...next, items } : next
}

function endedToolStatus(status: OAITurn['status']): ToolView['status'] {
  return status === 'failed' ? 'failed' : 'done'
}

/** Upserts one card per subagent with its live status and timing. */
export function applySubagents(s: ConversationState, children: SubagentActivity[]): ConversationState {
  let next = s
  for (const { subagent, turns } of children) {
    const last = turns.at(-1)
    const status = last?.status ?? (subagent.status === 'closed' ? 'completed' : 'queued')
    const terminal = status === 'completed' || status === 'failed' || status === 'cancelled'
    const endedAt = terminal ? (last?.completed_at ?? subagent.closed_at ?? undefined) : undefined
    next = placeSubagentView(next, subagent.id, {
      status,
      startedAt: turns[0]?.started_at ?? turns[0]?.created_at ?? subagent.created_at,
      endedAt: endedAt ?? undefined,
    })
  }
  return actionsLast(next)
}

/**
 * Sorts the views by the item log. A view backed by an item takes its log
 * position. Any other view (notice, delegation card, optimistic user message)
 * stays right after the view before it, except a subagent card (right after
 * the call that started it) and an assistant message the log does not have
 * yet (still streaming), which stays at the end of its turn.
 */
function inLogOrder(s: ConversationState, items: StoredSessionItem[]): ConversationState {
  const order = new Map<string, number>()
  const turnEnd = new Map<string, number>()
  items.forEach((item, i) => {
    if (item.type !== 'function_call_output') order.set(item.id, i)
    if (item.turn_id) turnEnd.set(item.turn_id, i)
  })
  let anchor = -1
  const keyed = s.items.map((view, index) => {
    let key = order.get(view.id)
    if (key === undefined && view.kind === 'subagent') {
      // Right after the call that started it.
      const spawn = s.items.find((v) => v.kind === 'tool' && typeof v.output === 'string' && v.output.includes(view.subagentId))
      const at = spawn ? order.get(spawn.id) : undefined
      if (at !== undefined) key = at + 1e-6
    }
    if (key === undefined) {
      const turn = s.turnOf.get(view.id)
      const end = view.kind === 'assistant' && turn !== undefined ? turnEnd.get(turn) : undefined
      key = Math.max(anchor, end ?? -Infinity) + 1e-6
    }
    anchor = key
    return { view, key, index }
  })
  keyed.sort((a, b) => a.key - b.key || a.index - b.index)
  if (keyed.every((k, i) => k.index === i)) return s
  return { ...s, items: keyed.map((k) => k.view) }
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
      return event.turn.subagent_id ? placeSubagent(s, event.turn) : { ...upsertTurn(s, event.turn), openTurn: event.turn.id }
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
      return placeAssistant(s, { kind: 'assistant', id: event.item_id, text, streaming: true }, event.turn_id)
    }
    case 'agent.session.turn.output_text.done': {
      const current = find(s.items, event.item_id)
      const streaming = current?.kind === 'assistant' ? current.streaming : true
      return placeAssistant(s, { kind: 'assistant', id: event.item_id, text: event.text, streaming }, event.turn_id)
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
  const recorded = upsertTurn(s, turn)
  let next: ConversationState = {
    ...recorded,
    openTurn: s.openTurn === turn.id ? null : s.openTurn,
    items: recorded.items.map((v) => ((v.kind === 'assistant' || v.kind === 'reasoning') && v.streaming ? { ...v, streaming: false } : v)),
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

/** A turn event for a subagent (if a backend ever streams one) updates its card. */
function placeSubagent(s: ConversationState, turn: OAITurn): ConversationState {
  const terminal = turn.status === 'completed' || turn.status === 'failed' || turn.status === 'cancelled'
  return placeSubagentView(s, turn.subagent_id ?? turn.id, {
    status: turn.status,
    startedAt: turn.started_at ?? turn.created_at,
    endedAt: terminal ? (turn.completed_at ?? undefined) : undefined,
  })
}

const SUBAGENT_NAME = 'Subagent'

/**
 * Upserts the card of `subagentId`. A new card goes right after the call that
 * started it (its output names the child), else at the end of the open turn.
 */
function placeSubagentView(
  s: ConversationState,
  subagentId: string,
  update: Pick<SubagentView, 'status' | 'startedAt' | 'endedAt'>,
): ConversationState {
  const id = `subagent:${subagentId}`
  const current = find(s.items, id)
  const spawn = s.items.find((v): v is ToolView => v.kind === 'tool' && typeof v.output === 'string' && v.output.includes(subagentId))
  const description = spawn && spawn.args && typeof spawn.args === 'object' ? (spawn.args as { description?: unknown }).description : undefined
  const name = typeof description === 'string' && description ? description : current?.kind === 'subagent' ? current.name : SUBAGENT_NAME
  const view: SubagentView = {
    kind: 'subagent',
    id,
    sessionId: s.sessionId,
    subagentId,
    name,
    status: update.status,
    startedAt: update.startedAt ?? (current?.kind === 'subagent' ? current.startedAt : undefined),
    endedAt: update.endedAt,
  }
  if (current || !spawn) return place(s, view, s.turnOf.get(id) ?? (spawn && s.turnOf.get(spawn.id)) ?? s.openTurn ?? undefined)
  const at = s.items.indexOf(spawn) + 1
  const turn = s.turnOf.get(spawn.id)
  const turnOf = turn ? new Map(s.turnOf).set(id, turn) : s.turnOf
  return { ...s, items: [...s.items.slice(0, at), view, ...s.items.slice(at)], turnOf }
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
        return current.streaming || !text ? s : placeAssistant(s, { ...current, text }, turn)
      }
      // A message streams until its turn ends, even once it is saved.
      const streaming = current?.kind === 'assistant' && current.streaming ? true : !done && item.status === 'in_progress'
      return placeAssistant(s, { kind: 'assistant', id: item.id, text, streaming }, turn)
    }
    case 'reasoning': {
      const text = (item.summary ?? []).map((p) => p.text).join('')
      const streaming = turn !== undefined && turn === s.openTurn
      const next = place(s, { kind: 'reasoning', id: item.id, text, streaming }, turn)
      // The step's message may already show this reasoning as its text.
      const message = find(next.items, messageIdOf(item.id))
      return message?.kind === 'assistant' ? placeAssistant(next, message, next.turnOf.get(message.id)) : next
    }
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
        name: COMMAND,
        args: item.cwd === undefined ? { command: item.command } : { command: item.command, cwd: item.cwd },
        status: toolStatus(item.status, 'running'),
        ...withOutput(item.output),
      }, turn)
    case 'function_call_output': {
      // A shell command's output carries a call id its `command_execution` item does not
      // have: it finishes the latest command of its turn that has no output yet.
      const call =
        s.items.find((v): v is ToolView => v.kind === 'tool' && v.callId === item.call_id) ??
        s.items.findLast((v): v is ToolView => v.kind === 'tool' && v.name === COMMAND && v.output === undefined && (!turn || s.turnOf.get(v.id) === turn))
      if (!call) return s
      const failed = item.status === 'failed' || item.status === 'incomplete' || Boolean(item.error)
      return place(s, { ...call, status: failed ? 'failed' : 'done', output: item.output }, turn)
    }
    default:
      return s
  }
}

const COMMAND = 'command'
const REASONING_PREFIX = 'item_reason_'
const MESSAGE_PREFIX = 'item_msg_'

/** The message of the same step: `item_reason_N` ↔ `item_msg_N` (backend `src/items.ts`). */
function messageIdOf(reasoningId: string): string {
  return reasoningId.startsWith(REASONING_PREFIX) ? MESSAGE_PREFIX + reasoningId.slice(REASONING_PREFIX.length) : ''
}

function reasoningIdOf(messageId: string): string {
  return messageId.startsWith(MESSAGE_PREFIX) ? REASONING_PREFIX + messageId.slice(MESSAGE_PREFIX.length) : ''
}

/** Upserts an assistant message without the reasoning of its step in front of its text. */
function placeAssistant(s: ConversationState, view: AssistantView, turn: string | undefined): ConversationState {
  const reasoning = find(s.items, reasoningIdOf(view.id)) as ReasoningView | undefined
  const prefix = reasoning?.kind === 'reasoning' ? reasoning.text : ''
  const text = prefix && view.text.startsWith(prefix) ? view.text.slice(prefix.length) : view.text
  return place(s, text === view.text ? view : { ...view, text }, turn)
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

/**
 * A re-sent call item never regresses a finished tool or drops its output. A
 * call first seen after its turn ended is settled at once.
 */
function placeTool(s: ConversationState, view: ToolView, turn: string | undefined): ConversationState {
  const current = find(s.items, view.id)
  if (current?.kind === 'tool' && current.status !== 'running') {
    return place(s, { ...view, status: current.status, ...withOutput(current.output ?? view.output) }, turn)
  }
  const record = turn ? s.turns.find((t) => t.id === turn) : undefined
  if (view.status === 'running' && view.output === undefined && record && TERMINAL_TURN.has(record.status)) {
    return place(s, { ...view, status: endedToolStatus(record.status) }, turn)
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
