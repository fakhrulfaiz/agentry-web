'use client'

/**
 * Live conversation state for one session.
 *
 * Opening (ruling R14): the saved items (`GET .../items`) are folded first, so
 * the history shows what the stream does not carry (user messages, tool calls,
 * reasoning). Only then is the stream requested with `Last-Event-ID: 0`:
 * Agentry replays every wire event (the reducer updates the views the items
 * created, by id) and continues live. Reconnects resume from the last seen id
 * and do not reload items. The session resource (`GET /agents/sessions/{id}`) is
 * applied as an id-less status snapshot so pending approvals (ephemeral, never
 * replayed) appear; it is fetched again on every reconnect, because approval
 * changes made while disconnected are not replayed either. The snapshot is
 * awaited (up to `SNAPSHOT_WAIT_MS`) before the stream opens, so every stream
 * event is applied after it; a snapshot that answers later is applied only if
 * no stream event arrived since it was requested, so it never overwrites a
 * newer status or approval.
 *
 * Items during a turn: the backend stream carries assistant messages only, so
 * user messages, reasoning and tool calls arrive through `GET .../items`. The
 * saved log is append-only, so after the first full load only the items after
 * the last known one are read (`after=<id>`). They are refreshed shortly after
 * each durable `item.done` or turn end that is new (coalesced,
 * `ITEMS_REFRESH_DELAY_MS`; the replay of items and turns already loaded asks
 * for nothing), and polled while the session is in progress: every
 * `ITEMS_POLL_MS`, backing off to `ITEMS_POLL_MAX_MS` while nothing changes,
 * back to the start on any change. The newest turn records (`GET .../turns`,
 * for the trace) are read with them.
 * Subagents (`GET .../subagents`, each one's turns and items; one read at a
 * time) are read with the items; a subagent can outlive the turn that started
 * it, so the poll also runs while one is still working. A finished, closed
 * subagent's turns and items are not read again. A hidden tab does not poll;
 * it refreshes when it becomes visible. Polling stops once nothing runs.
 *
 * Opening a chat again in this tab shows its last read history at once (kept
 * in memory, see `page-cache`) while the reads above refresh it; the cached
 * status counts only for an idle session, so no stale approval is offered.
 * The session snapshot is requested together with the first items read (its
 * answer is still applied after them), so opening costs one round trip, not two.
 *
 * Reconnecting: when the stream ends or fails it is retried after 1s, doubling
 * to a 30s cap, always resending the last seen id. A connection that delivered
 * an event, or stayed open for `STABLE_CONNECTION_MS`, resets the delay. A
 * hidden tab coming back to the foreground retries at once. A 401 sends the
 * user to `/login`; a 403 or 404 closes the stream and sets `closedReason`.
 */
import type { UserFile } from './attachments'
import { useCallback, useEffect, useReducer, useRef, useState } from 'react'
import { api, isSignedOut, type SettingsChange } from '@/api/client'
import type { OAIAgentSession, OAISessionEvent, OAITurn, StoredSessionItem } from '@/api/types'
import {
  appendLocalUserMessage,
  applyEvent,
  applyItems,
  applySubagents,
  applyTurns,
  initialState,
  LOCAL_PREFIX,
  removeLocalUserMessage,
  type ConversationState,
  type SubagentActivity,
} from './reducer'
import { clearPendingFirst, peekPendingFirst } from './pending-first'
import { readSse } from './sse'
import { cached, remember } from '@/ui/page-cache'

export type Connection = 'live' | 'reconnecting' | 'closed'
/** Why the stream was closed for good (403 or 404 from the stream route). */
export type ClosedReason = 'forbidden' | 'not_found'
export type ActionAnswer = { decision: 'approve' | 'deny' | 'answer'; payload?: unknown }

export const BACKOFF_START_MS = 1_000
export const BACKOFF_CAP_MS = 30_000
/** A connection that stayed open this long resets the backoff, even without events. */
export const STABLE_CONNECTION_MS = 30_000
/** How long the session snapshot may hold back opening the stream. */
export const SNAPSHOT_WAIT_MS = 5_000
/** Items poll interval while a turn runs; it backs off to `ITEMS_POLL_MAX_MS` while nothing changes. */
export const ITEMS_POLL_MS = 1_500
export const ITEMS_POLL_MAX_MS = 5_000
/** The poll delays after 0, 1, 2… rounds without a change. */
const POLL_STEPS_MS = [ITEMS_POLL_MS, 3_000, ITEMS_POLL_MAX_MS]
/** How many of the newest turns a poll reads. */
export const RECENT_TURNS = 5
/** Delay that coalesces item refreshes asked for by a burst of events. */
export const ITEMS_REFRESH_DELAY_MS = 250

const ACTIVE = new Set(['in_progress', 'requires_action'])
const TERMINAL = new Set<OAITurn['status']>(['completed', 'failed', 'cancelled'])
const REFRESH_ON = new Set([
  'agent.session.turn.item.done',
  'agent.session.turn.completed',
  'agent.session.turn.failed',
  'agent.session.turn.cancelled',
])

type Action =
  | { type: 'reset'; sessionId: string }
  | { type: 'event'; id?: string; event: OAISessionEvent }
  | { type: 'items'; items: StoredSessionItem[] }
  | { type: 'turns'; turns: OAITurn[] }
  | { type: 'subagents'; children: SubagentActivity[] }
  | { type: 'local-user'; text: string; files?: UserFile[] }
  | { type: 'drop-local'; text: string }

/** Initial state; a first message sent from the new-chat page is already on screen. */
/** What a revisit shows at once: the last history and session this tab read. */
interface ChatMemory {
  items?: StoredSessionItem[]
  turns?: OAITurn[]
  session?: OAIAgentSession
}
const memoryKey = (sessionId: string) => `chat:${sessionId}`
function recall(sessionId: string, part: Partial<ChatMemory>): void {
  remember(memoryKey(sessionId), { ...cached<ChatMemory>(memoryKey(sessionId)), ...part })
}

function seededState(sessionId: string): ConversationState {
  const first = peekPendingFirst(sessionId)
  const empty = initialState(sessionId)
  return first ? appendLocalUserMessage(empty, first.text, first.files) : empty
}

function reducer(s: ConversationState, a: Action): ConversationState {
  switch (a.type) {
    case 'reset':
      return s.sessionId === a.sessionId && s.lastEventId === null && s.items.every((v) => v.id.startsWith(LOCAL_PREFIX)) ? s : initialState(a.sessionId)
    case 'event':
      return applyEvent(s, a.id === undefined ? { event: a.event } : { id: a.id, event: a.event })
    case 'items':
      return applyItems(s, a.items)
    case 'turns':
      return applyTurns(s, a.turns)
    case 'subagents':
      return applySubagents(s, a.children)
    case 'local-user':
      return appendLocalUserMessage(s, a.text, a.files)
    case 'drop-local':
      return removeLocalUserMessage(s, a.text)
  }
}

/** The session resource as an id-less status event. */
export function snapshotEvent(session: OAIAgentSession): OAISessionEvent {
  return { type: `agent.session.${session.status}`, event_id: `snapshot_${session.id}`, session } as OAISessionEvent
}

/** Resolves when `p` settles or after `ms`, whichever is first. */
function withTimeout(p: Promise<void>, ms: number): Promise<void> {
  return new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, ms)
    void p.finally(() => {
      clearTimeout(timer)
      resolve()
    })
  })
}

export function streamUrl(sessionId: string): string {
  return `/api/agentry/sessions/${encodeURIComponent(sessionId)}/stream`
}

export function goToLogin(): void {
  window.location.assign('/login')
}

export function useConversation(
  sessionId: string,
  options: { onSignedOut?: () => void } = {},
): {
  state: ConversationState
  /** False until the saved history has been read (or failed to load). */
  loaded: boolean
  /** False until the session status is known (the first snapshot or stream frame has been read). */
  ready: boolean
  connection: Connection
  closedReason: ClosedReason | null
  /** Sends a message, with the model / effort the user changed (if any). */
  send(text: string, change?: SettingsChange, files?: UserFile[]): Promise<void>
  stop(): Promise<void>
  answer(actionId: string, a: ActionAnswer): Promise<void>
  /** Runs a backend slash command and shows its result item at once (the stream carries the same item). */
  runCommand(name: string, input: string): Promise<void>
} {
  const [state, dispatch] = useReducer(reducer, sessionId, seededState)
  // Optimistic until the first connection fails, so opening a chat does not flash "Reconnecting…".
  const [connection, setConnection] = useState<Connection>('live')
  const [closedReason, setClosedReason] = useState<ClosedReason | null>(null)
  const [loaded, setLoaded] = useState(false)
  const [ready, setReady] = useState(false)
  // A ref, so an inline callback does not restart the stream on every render.
  const signedOutRef = useRef(options.onSignedOut ?? goToLogin)
  useEffect(() => {
    signedOutRef.current = options.onSignedOut ?? goToLogin
  })
  const onSignedOut = useCallback(() => signedOutRef.current(), [])

  useEffect(() => {
    dispatch({ type: 'reset', sessionId })
    clearPendingFirst(sessionId)
    setConnection('live')
    setClosedReason(null)
    setLoaded(false)
    setReady(false)
    const memory = cached<ChatMemory>(memoryKey(sessionId))
    if (memory?.items) {
      dispatch({ type: 'items', items: memory.items })
      if (memory.turns) dispatch({ type: 'turns', turns: memory.turns })
      setLoaded(true)
      if (memory.session && !ACTIVE.has(memory.session.status)) {
        dispatch({ type: 'event', event: snapshotEvent(memory.session) })
        setReady(true)
      }
    }
    const abort = new AbortController()
    const { signal } = abort
    let lastId = '0'
    let attempt = 0
    // Counts stream events applied, so a late snapshot can tell it is stale.
    let applied = 0
    let wake: (() => void) | null = null
    // Items refresh: whether a turn runs, the pending delayed refresh, and one fetch in flight at a time.
    let active = false
    let refreshTimer: ReturnType<typeof setTimeout> | null = null
    let refreshing = false
    let refreshAgain = false
    // Polling: the pending poll and how many rounds in a row changed nothing.
    let pollTimer: ReturnType<typeof setTimeout> | null = null
    let quiet = 0
    // The saved log as read so far, and the turns known to have ended.
    let log: StoredSessionItem[] = []
    let known = new Set<string>()
    const endedTurns = new Set<string>()
    let turnsSeen = ''
    // Subagents: whether one still works, the turns of finished, closed ones, and the read in flight.
    let childrenRunning = false
    let childrenSeen = ''
    const finishedChildren = new Map<string, { turns: OAITurn[]; items: StoredSessionItem[] }>()
    let subagentsRead: Promise<boolean> | null = null
    let subagentsAgain = false

    const sleep = (ms: number) =>
      new Promise<void>((resolve) => {
        const done = () => {
          clearTimeout(timer)
          signal.removeEventListener('abort', done)
          wake = null
          resolve()
        }
        const timer = setTimeout(done, ms)
        signal.addEventListener('abort', done)
        wake = done
      })

    const onVisibility = () => {
      if (document.visibilityState !== 'visible') return
      wake?.()
      if (active || childrenRunning) {
        quiet = 0
        scheduleRefresh()
      }
    }
    document.addEventListener('visibilitychange', onVisibility)

    /** `early`: a read already started (with the first items read), else a new one. */
    const snapshot = async (early?: Promise<OAIAgentSession>) => {
      const requestedAt = applied
      try {
        const session = await (early ?? api.getSession(sessionId))
        if (!signal.aborted && applied === requestedAt) {
          recall(sessionId, { session })
          active = ACTIVE.has(session.status)
          dispatch({ type: 'event', event: snapshotEvent(session) })
          setReady(true)
          schedulePoll()
        }
      } catch (error) {
        if (!signal.aborted && isSignedOut(error)) onSignedOut()
        // Otherwise the stream (and its replay) still drives the view.
      }
    }

    /**
     * Reads the saved items (all of them when `full`, else only the new ones)
     * and the turn records. Null when aborted or signed out; otherwise whether
     * anything changed.
     */
    const loadItems = async (full: boolean): Promise<boolean | null> => {
      let changed = false
      try {
        // Turn records (status, timing, usage) feed the trace; optional, so a failure is ignored.
        const turns = (full ? api.turns(sessionId) : api.recentTurns(sessionId, RECENT_TURNS)).catch(() => null)
        const after = full ? undefined : log.at(-1)?.id
        const fresh = await api.items(sessionId, after)
        if (signal.aborted) return null
        const added = full ? fresh : fresh.filter((item) => !known.has(item.id))
        if (full || added.length > 0) {
          log = full ? fresh : [...log, ...added]
          known = new Set(log.map((item) => item.id))
          changed = added.length > 0
          dispatch({ type: 'items', items: log })
          recall(sessionId, { items: log })
        }
        const records = await turns
        if (!signal.aborted && records) {
          for (const t of records) if (TERMINAL.has(t.status)) endedTurns.add(t.id)
          const seen = JSON.stringify(records.map((t) => [t.id, t.status, t.completed_at, t.usage?.total_tokens]))
          if (full || seen !== turnsSeen) {
            changed ||= !full
            dispatch({ type: 'turns', turns: records })
            if (full) recall(sessionId, { turns: records })
          }
          turnsSeen = seen
        }
      } catch (error) {
        if (signal.aborted) return null
        if (isSignedOut(error)) {
          setConnection('closed')
          onSignedOut()
          return null
        }
        // Any other failure: the stream replay still shows the assistant side.
      }
      return signal.aborted ? null : changed
    }

    const readSubagents = async (): Promise<boolean> => {
      try {
        const list = await api.subagents(sessionId)
        const children = await Promise.all(
          list.map(async (subagent): Promise<SubagentActivity> => {
            const known = finishedChildren.get(subagent.id)
            if (known) return { subagent, ...known }
            const [turns, items] = await Promise.all([
              api.subagentTurns(sessionId, subagent.id),
              // The trajectory and the card nest a subagent's own activity; optional.
              api.subagentItems(sessionId, subagent.id).catch(() => undefined),
            ])
            const run = items ? { turns, items } : { turns }
            if (subagent.status === 'closed' && turns.every((t) => TERMINAL.has(t.status)) && items) finishedChildren.set(subagent.id, { turns, items })
            return { subagent, ...run }
          }),
        )
        if (signal.aborted) return false
        childrenRunning = children.some(({ subagent, turns }) => subagent.status === 'active' && !TERMINAL.has(turns.at(-1)?.status ?? 'queued'))
        const seen = JSON.stringify(children.map(({ subagent, turns, items }) => [subagent.id, subagent.status, turns.map((t) => [t.id, t.status, t.completed_at]), items?.length ?? -1]))
        if (seen === childrenSeen) return false
        childrenSeen = seen
        if (children.length > 0) dispatch({ type: 'subagents', children })
        return true
      } catch (error) {
        if (!signal.aborted && isSignedOut(error)) onSignedOut()
        // Otherwise optional: the conversation works without subagent cards.
        return false
      }
    }

    /** One subagent read at a time; a call during one reads again after it and shares its result. */
    const loadSubagents = (): Promise<boolean> => {
      if (subagentsRead) {
        subagentsAgain = true
        return subagentsRead
      }
      const read = (async () => {
        let changed = false
        try {
          do {
            subagentsAgain = false
            changed = (await readSubagents()) || changed
          } while (subagentsAgain && !signal.aborted)
        } finally {
          subagentsRead = null
        }
        schedulePoll()
        return changed
      })()
      subagentsRead = read
      return read
    }

    const refreshItems = async () => {
      if (refreshing) {
        refreshAgain = true
        return
      }
      refreshing = true
      let changed = false
      try {
        do {
          refreshAgain = false
          const items = await loadItems(false)
          if (items === null) return
          const children = await loadSubagents()
          changed = changed || items || children
        } while (refreshAgain)
      } finally {
        refreshing = false
      }
      quiet = changed ? 0 : quiet + 1
      if (pollTimer !== null) clearTimeout(pollTimer)
      pollTimer = null
      schedulePoll()
    }
    const scheduleRefresh = () => {
      if (refreshTimer !== null || signal.aborted) return
      refreshTimer = setTimeout(() => {
        refreshTimer = null
        void refreshItems()
      }, ITEMS_REFRESH_DELAY_MS)
    }
    /** The next poll, while a turn or a subagent runs; later the longer nothing changed. */
    function schedulePoll() {
      if (pollTimer !== null || signal.aborted || !(active || childrenRunning)) return
      pollTimer = setTimeout(() => {
        pollTimer = null
        // A hidden tab does not poll; it refreshes when it comes back. Nothing running: polling stops.
        if (document.visibilityState === 'hidden' || !(active || childrenRunning)) return
        void refreshItems()
      }, POLL_STEPS_MS[Math.min(quiet, POLL_STEPS_MS.length - 1)])
    }
    const track = (event: OAISessionEvent, durable: boolean) => {
      if ('session' in event) {
        active = ACTIVE.has(event.session.status)
        setReady(true)
        schedulePoll()
      }
      if (!durable || !REFRESH_ON.has(event.type)) return
      // A replayed frame for an item or a turn end already loaded brings nothing new.
      if ('item' in event && known.has(event.item.id)) return
      if ('turn' in event && endedTurns.has(event.turn.id)) return
      quiet = 0
      scheduleRefresh()
    }

    const run = async () => {
      // No stream event can arrive before the first snapshot, so starting its read now is safe.
      let early: Promise<OAIAgentSession> | undefined = api.getSession(sessionId)
      early.catch(() => {})
      const history = await loadItems(true)
      if (history === null) return
      setLoaded(true)
      // Not awaited: subagent cards must not hold back the stream.
      void loadSubagents()
      while (!signal.aborted) {
        let received = false
        let openedAt: number | null = null
        await withTimeout(snapshot(early), SNAPSHOT_WAIT_MS)
        early = undefined
        if (signal.aborted) return
        try {
          const res = await fetch(streamUrl(sessionId), {
            headers: { accept: 'text/event-stream', 'last-event-id': lastId },
            credentials: 'same-origin',
            cache: 'no-store',
            signal,
          })
          if (res.status === 401) {
            setConnection('closed')
            onSignedOut()
            return
          }
          if (res.status === 403 || res.status === 404) {
            await res.body?.cancel()
            setConnection('closed')
            setClosedReason(res.status === 403 ? 'forbidden' : 'not_found')
            return
          }
          if (res.ok && res.body) {
            setConnection('live')
            openedAt = Date.now()
            for await (const message of readSse(res.body)) {
              let event: OAISessionEvent
              try {
                event = JSON.parse(message.data) as OAISessionEvent
              } catch {
                continue
              }
              received = true
              applied += 1
              if (message.id !== undefined) lastId = message.id
              dispatch({ type: 'event', ...(message.id !== undefined && { id: message.id }), event })
              track(event, message.id !== undefined)
            }
          } else {
            await res.body?.cancel()
          }
        } catch {
          // Network failure or abort; the loop condition decides.
        }
        if (signal.aborted) return
        setConnection('reconnecting')
        if (received || (openedAt !== null && Date.now() - openedAt >= STABLE_CONNECTION_MS)) attempt = 0
        const delay = Math.min(BACKOFF_START_MS * 2 ** attempt, BACKOFF_CAP_MS)
        attempt += 1
        await sleep(delay)
      }
    }
    void run()

    return () => {
      abort.abort()
      if (pollTimer !== null) clearTimeout(pollTimer)
      if (refreshTimer !== null) clearTimeout(refreshTimer)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [sessionId, onSignedOut])

  const guard = useCallback(async <T,>(call: () => Promise<T>): Promise<T> => {
    try {
      return await call()
    } catch (error) {
      if (isSignedOut(error)) onSignedOut()
      throw error
    }
  }, [onSignedOut])

  const send = useCallback(
    async (text: string, change?: SettingsChange, files?: UserFile[]) => {
      dispatch({ type: 'local-user', text, files })
      try {
        await guard(() => api.sendMessage(sessionId, text, change, files))
      } catch (error) {
        dispatch({ type: 'drop-local', text })
        throw error
      }
    },
    [guard, sessionId],
  )

  const stop = useCallback(() => guard(() => api.cancel(sessionId)), [guard, sessionId])

  const answer = useCallback(
    (actionId: string, a: ActionAnswer) => guard(() => api.answerAction(sessionId, actionId, a)),
    [guard, sessionId],
  )

  const runCommand = useCallback(
    async (name: string, input: string) => {
      const result = await guard(() => api.runCommand(sessionId, name, input))
      // No SSE id: the item is upserted by its id, so the stream's copy does not double it.
      dispatch({ type: 'event', event: { type: 'agent.session.item.done', event_id: `command_${result.command_id}`, session_id: sessionId, turn_id: result.item.turn_id, item: result.item } })
    },
    [guard, sessionId],
  )

  return { state, loaded, ready, connection, closedReason, send, stop, answer, runCommand }
}
