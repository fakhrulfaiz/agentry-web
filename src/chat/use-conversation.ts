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
 * items are refreshed shortly after each durable `item.done` or turn end
 * (coalesced, `ITEMS_REFRESH_DELAY_MS`) and every `ITEMS_POLL_MS` while the
 * session is in progress, so running tools show up before the next message.
 * The turn records (`GET .../turns`, for the trace) are read with them.
 * Subagents (`GET .../subagents`, each one's turns and items) are read with the items;
 * a subagent can outlive the turn that started it, so the poll also runs while
 * one is still working. A finished, closed subagent's turns and items are not read again.
 * A hidden tab does not poll; it refreshes when it becomes visible.
 *
 * Reconnecting: when the stream ends or fails it is retried after 1s, doubling
 * to a 30s cap, always resending the last seen id. A connection that delivered
 * an event, or stayed open for `STABLE_CONNECTION_MS`, resets the delay. A
 * hidden tab coming back to the foreground retries at once. A 401 sends the
 * user to `/login`; a 403 or 404 closes the stream and sets `closedReason`.
 */
import { useCallback, useEffect, useReducer, useRef, useState } from 'react'
import { api, isSignedOut } from '@/api/client'
import type { OAIAgentSession, OAISessionEvent, OAITurn, StoredSessionItem } from '@/api/types'
import {
  appendLocalUserMessage,
  applyEvent,
  applyItems,
  applySubagents,
  applyTurns,
  initialState,
  removeLocalUserMessage,
  type ConversationState,
  type SubagentActivity,
} from './reducer'
import { readSse } from './sse'

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
/** Items poll interval while a turn runs. */
export const ITEMS_POLL_MS = 1_500
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
  | { type: 'local-user'; text: string }
  | { type: 'drop-local'; text: string }

function reducer(s: ConversationState, a: Action): ConversationState {
  switch (a.type) {
    case 'reset':
      return s.sessionId === a.sessionId && s.lastEventId === null && s.items.length === 0 ? s : initialState(a.sessionId)
    case 'event':
      return applyEvent(s, a.id === undefined ? { event: a.event } : { id: a.id, event: a.event })
    case 'items':
      return applyItems(s, a.items)
    case 'turns':
      return applyTurns(s, a.turns)
    case 'subagents':
      return applySubagents(s, a.children)
    case 'local-user':
      return appendLocalUserMessage(s, a.text)
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
  connection: Connection
  closedReason: ClosedReason | null
  send(text: string): Promise<void>
  stop(): Promise<void>
  answer(actionId: string, a: ActionAnswer): Promise<void>
} {
  const [state, dispatch] = useReducer(reducer, sessionId, initialState)
  // Optimistic until the first connection fails, so opening a chat does not flash "Reconnecting…".
  const [connection, setConnection] = useState<Connection>('live')
  const [closedReason, setClosedReason] = useState<ClosedReason | null>(null)
  // A ref, so an inline callback does not restart the stream on every render.
  const signedOutRef = useRef(options.onSignedOut ?? goToLogin)
  useEffect(() => {
    signedOutRef.current = options.onSignedOut ?? goToLogin
  })
  const onSignedOut = useCallback(() => signedOutRef.current(), [])

  useEffect(() => {
    dispatch({ type: 'reset', sessionId })
    setConnection('live')
    setClosedReason(null)
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
    // Subagents: whether one still works, and the turns of finished, closed ones.
    let childrenRunning = false
    const finishedChildren = new Map<string, { turns: OAITurn[]; items: StoredSessionItem[] }>()

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
      if (active || childrenRunning) scheduleRefresh()
    }
    document.addEventListener('visibilitychange', onVisibility)

    const snapshot = async () => {
      const requestedAt = applied
      try {
        const session = await api.getSession(sessionId)
        if (!signal.aborted && applied === requestedAt) {
          active = ACTIVE.has(session.status)
          dispatch({ type: 'event', event: snapshotEvent(session) })
        }
      } catch (error) {
        if (!signal.aborted && isSignedOut(error)) onSignedOut()
        // Otherwise the stream (and its replay) still drives the view.
      }
    }

    const loadItems = async (): Promise<boolean> => {
      try {
        // Turn records (status, timing, usage) feed the trace; optional, so a failure is ignored.
        const turns = api.turns(sessionId).catch(() => null)
        const items = await api.items(sessionId)
        if (!signal.aborted) dispatch({ type: 'items', items })
        const records = await turns
        if (!signal.aborted && records) dispatch({ type: 'turns', turns: records })
      } catch (error) {
        if (signal.aborted) return false
        if (isSignedOut(error)) {
          setConnection('closed')
          onSignedOut()
          return false
        }
        // Any other failure: the stream replay still shows the assistant side.
      }
      return !signal.aborted
    }

    const loadSubagents = async () => {
      try {
        const list = await api.subagents(sessionId)
        const children = await Promise.all(
          list.map(async (subagent): Promise<SubagentActivity> => {
            const known = finishedChildren.get(subagent.id)
            if (known) return { subagent, ...known }
            const [turns, items] = await Promise.all([
              api.subagentTurns(sessionId, subagent.id),
              // The trajectory nests a subagent's own activity; optional.
              api.subagentItems(sessionId, subagent.id).catch(() => undefined),
            ])
            const run = items ? { turns, items } : { turns }
            if (subagent.status === 'closed' && turns.every((t) => TERMINAL.has(t.status)) && items) finishedChildren.set(subagent.id, { turns, items })
            return { subagent, ...run }
          }),
        )
        if (signal.aborted) return
        childrenRunning = children.some(({ subagent, turns }) => subagent.status === 'active' && !TERMINAL.has(turns.at(-1)?.status ?? 'queued'))
        if (children.length > 0) dispatch({ type: 'subagents', children })
      } catch (error) {
        if (!signal.aborted && isSignedOut(error)) onSignedOut()
        // Otherwise optional: the conversation works without subagent cards.
      }
    }

    const refreshItems = async () => {
      if (refreshing) {
        refreshAgain = true
        return
      }
      refreshing = true
      try {
        do {
          refreshAgain = false
          if (!(await loadItems())) return
          await loadSubagents()
        } while (refreshAgain)
      } finally {
        refreshing = false
      }
    }
    const scheduleRefresh = () => {
      if (refreshTimer !== null || signal.aborted) return
      refreshTimer = setTimeout(() => {
        refreshTimer = null
        void refreshItems()
      }, ITEMS_REFRESH_DELAY_MS)
    }
    const poll = setInterval(() => {
      // A hidden tab does not poll; it refreshes when it comes back.
      if ((active || childrenRunning) && document.visibilityState !== 'hidden') scheduleRefresh()
    }, ITEMS_POLL_MS)
    const track = (event: OAISessionEvent, durable: boolean) => {
      if ('session' in event) active = ACTIVE.has(event.session.status)
      if (durable && REFRESH_ON.has(event.type)) scheduleRefresh()
    }

    const run = async () => {
      if (!(await loadItems())) return
      // Not awaited: subagent cards must not hold back the stream.
      void loadSubagents()
      while (!signal.aborted) {
        let received = false
        let openedAt: number | null = null
        await withTimeout(snapshot(), SNAPSHOT_WAIT_MS)
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
      clearInterval(poll)
      if (refreshTimer !== null) clearTimeout(refreshTimer)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [sessionId, onSignedOut])

  const guard = useCallback(async (call: () => Promise<void>) => {
    try {
      await call()
    } catch (error) {
      if (isSignedOut(error)) onSignedOut()
      throw error
    }
  }, [onSignedOut])

  const send = useCallback(
    async (text: string) => {
      dispatch({ type: 'local-user', text })
      try {
        await guard(() => api.sendMessage(sessionId, text))
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

  return { state, connection, closedReason, send, stop, answer }
}
