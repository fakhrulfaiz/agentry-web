'use client'

/**
 * Live conversation state for one session.
 *
 * Opening (ruling R14): the saved items (`GET .../items`) are folded first, so
 * the whole history shows at once. The stream (`Last-Event-ID: 0`) is requested
 * at the same time, so its round trip overlaps the history read, but it is only
 * read after the items (and the snapshot): Agentry replays every wire event (the
 * reducer updates the views the items created, by id) and continues live. Reconnects resume from
 * the last seen id and do not reload items. The session resource (`GET /agents/sessions/{id}`) is
 * applied as an id-less status snapshot so pending approvals (ephemeral, never
 * replayed) appear; it is fetched again on every reconnect, because approval
 * changes made while disconnected are not replayed either. The snapshot is
 * awaited (up to `SNAPSHOT_WAIT_MS`) before the stream opens, so every stream
 * event is applied after it; a snapshot that answers later is applied only if
 * no stream event arrived since it was requested, so it never overwrites a
 * newer status or approval.
 *
 * Items during a turn: the stream carries the full item log (user messages,
 * reasoning, tool calls and outputs, since 2026-11-26), so nothing is polled
 * while it is live. Subagent activity arrives as live `subagent.*` events,
 * which are never replayed: subagents (`GET .../subagents`, each one's turns
 * and items; one read at a time) are read on open and again on every
 * reconnect, with the newest turn records (`GET .../turns`, for the trace). A
 * finished, closed subagent's turns and items are not read again. Background
 * jobs (`GET .../jobs`) are read the same way, on open and every reconnect;
 * live `job.*` events keep them current in between.
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
import type { OAIAgentSession, OAIJob, OAISessionEvent, OAITurn, StoredSessionItem } from '@/api/types'
import {
  appendLocalUserMessage,
  applyEvent,
  applyItems,
  applyJobs,
  applySubagents,
  applyTurns,
  initialState,
  LOCAL_PREFIX,
  removeLocalUserMessage,
  type ConversationState,
  type SubagentActivity,
} from './reducer'
import { clearPendingFirst, peekPendingFirst, type FirstSend } from './pending-first'
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
/** How many of the newest turns a reconnect reads. */
export const RECENT_TURNS = 5

const ACTIVE = new Set(['in_progress', 'requires_action'])
const TERMINAL = new Set<OAITurn['status']>(['completed', 'failed', 'cancelled'])

type Action =
  | { type: 'reset'; sessionId: string }
  | { type: 'event'; id?: string; event: OAISessionEvent }
  | { type: 'items'; items: StoredSessionItem[] }
  | { type: 'turns'; turns: OAITurn[] }
  | { type: 'subagents'; children: SubagentActivity[] }
  | { type: 'jobs'; jobs: OAIJob[] }
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
    case 'jobs':
      return applyJobs(s, a.jobs)
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
  /** The new-chat handoff this session consumed, if it was just created from `/`. */
  firstSend: FirstSend | null
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
  // Captured during render, keyed by session: StrictMode runs the mount effect twice in development,
  // and the second run would otherwise see the handoff already cleared and erase the label.
  const firstSendRef = useRef<{ sessionId: string; handoff: FirstSend | null } | null>(null)
  if (firstSendRef.current?.sessionId !== sessionId) {
    const handoff = peekPendingFirst(sessionId)
    firstSendRef.current = { sessionId, handoff: handoff ? { startLabel: handoff.startLabel ?? 'Starting the chat…' } : null }
  }
  const firstSend = firstSendRef.current.handoff
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
    let turnsSeen = ''
    // Subagents: the turns and items of finished, closed ones, and the read in flight.
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
      if (document.visibilityState === 'visible') wake?.()
    }
    document.addEventListener('visibilitychange', onVisibility)

    /** `early`: a read already started (with the first items read), else a new one. */
    const snapshot = async (early?: Promise<OAIAgentSession>) => {
      const requestedAt = applied
      try {
        const session = await (early ?? api.getSession(sessionId))
        if (!signal.aborted && applied === requestedAt) {
          recall(sessionId, { session })
          dispatch({ type: 'event', event: snapshotEvent(session) })
          setReady(true)
        }
      } catch (error) {
        if (!signal.aborted && isSignedOut(error)) onSignedOut()
        // Otherwise the stream (and its replay) still drives the view.
      }
    }

    /** Reads every saved item and the turn records. False when aborted or signed out. */
    const loadItems = async (): Promise<boolean> => {
      try {
        // Turn records (status, timing, usage) feed the trace; optional, so a failure is ignored.
        const turns = api.turns(sessionId).catch(() => null)
        const log = await api.items(sessionId)
        if (signal.aborted) return false
        dispatch({ type: 'items', items: log })
        recall(sessionId, { items: log })
        const records = await turns
        if (!signal.aborted && records) {
          dispatch({ type: 'turns', turns: records })
          recall(sessionId, { turns: records })
        }
      } catch (error) {
        if (signal.aborted) return false
        if (isSignedOut(error)) {
          setConnection('closed')
          onSignedOut()
          return false
        }
        // Any other failure: the stream replay still shows the conversation.
      }
      return !signal.aborted
    }

    /** The newest turn records, re-read on a reconnect (the replay may not cover a record's latest usage). */
    const loadRecentTurns = async () => {
      try {
        const records = await api.recentTurns(sessionId, RECENT_TURNS)
        const seen = JSON.stringify(records.map((t) => [t.id, t.status, t.completed_at, t.usage?.total_tokens]))
        if (signal.aborted || seen === turnsSeen) return
        turnsSeen = seen
        dispatch({ type: 'turns', turns: records })
      } catch (error) {
        if (!signal.aborted && isSignedOut(error)) onSignedOut()
      }
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

    /** Background jobs; their `job.*` events are live only, so this runs on open and on every reconnect. Optional. */
    const loadJobs = async () => {
      try {
        const jobs = await api.jobs(sessionId)
        if (!signal.aborted) dispatch({ type: 'jobs', jobs })
      } catch (error) {
        if (!signal.aborted && isSignedOut(error)) onSignedOut()
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
        return changed
      })()
      subagentsRead = read
      return read
    }

    const run = async () => {
      // No stream event can arrive before the first snapshot, so starting its read now is safe.
      let early: Promise<OAIAgentSession> | undefined = api.getSession(sessionId)
      early.catch(() => {})
      const connect = () => fetch(streamUrl(sessionId), {
        headers: { accept: 'text/event-stream', 'last-event-id': lastId },
        credentials: 'same-origin',
        cache: 'no-store',
        signal,
      })
      // The first stream request starts with the history read, so its round trip overlaps it. Its events are
      // only read (and applied) after the items and the snapshot, as before; the server just buffers them.
      let firstStream: Promise<Response> | undefined = connect()
      firstStream.catch(() => {})
      if (!(await loadItems())) {
        void firstStream.then((r) => r.body?.cancel(), () => undefined)
        return
      }
      setLoaded(true)
      // Not awaited: subagent cards must not hold back the stream.
      void loadSubagents()
      void loadJobs()
      let reconnect = false
      while (!signal.aborted) {
        if (reconnect) {
          // Subagent events are never replayed: catch up on what happened while disconnected.
          void loadSubagents()
          void loadJobs()
          void loadRecentTurns()
        }
        reconnect = true
        let received = false
        let openedAt: number | null = null
        await withTimeout(snapshot(early), SNAPSHOT_WAIT_MS)
        early = undefined
        if (signal.aborted) return
        try {
          const pending = firstStream
          firstStream = undefined
          const res = await (pending ?? connect())
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
              if ('session' in event) setReady(true)
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

  return { state, loaded, ready, firstSend, connection, closedReason, send, stop, answer, runCommand }
}
