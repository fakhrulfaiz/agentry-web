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
 * changes made while disconnected are not replayed either.
 *
 * Reconnecting: when the stream ends or fails it is retried after 1s, doubling
 * to a 30s cap, always resending the last seen id. A connection that delivered
 * an event resets the delay. A hidden tab coming back to the foreground retries
 * at once. A 401 sends the user to `/login`; a 403 or 404 closes the stream.
 */
import { useCallback, useEffect, useReducer, useRef, useState } from 'react'
import { api, isSignedOut } from '@/api/client'
import type { OAIAgentSession, OAISessionEvent, StoredSessionItem } from '@/api/types'
import {
  appendLocalUserMessage,
  applyEvent,
  applyItems,
  initialState,
  removeLocalUserMessage,
  type ConversationState,
} from './reducer'
import { readSse } from './sse'

export type Connection = 'live' | 'reconnecting' | 'closed'
export type ActionAnswer = { decision: 'approve' | 'deny' | 'answer'; payload?: unknown }

export const BACKOFF_START_MS = 1_000
export const BACKOFF_CAP_MS = 30_000

type Action =
  | { type: 'reset'; sessionId: string }
  | { type: 'event'; id?: string; event: OAISessionEvent }
  | { type: 'items'; items: StoredSessionItem[] }
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
  send(text: string): Promise<void>
  stop(): Promise<void>
  answer(actionId: string, a: ActionAnswer): Promise<void>
} {
  const [state, dispatch] = useReducer(reducer, sessionId, initialState)
  // Optimistic until the first connection fails, so opening a chat does not flash "Reconnecting…".
  const [connection, setConnection] = useState<Connection>('live')
  // A ref, so an inline callback does not restart the stream on every render.
  const signedOutRef = useRef(options.onSignedOut ?? goToLogin)
  useEffect(() => {
    signedOutRef.current = options.onSignedOut ?? goToLogin
  })
  const onSignedOut = useCallback(() => signedOutRef.current(), [])

  useEffect(() => {
    dispatch({ type: 'reset', sessionId })
    setConnection('live')
    const abort = new AbortController()
    const { signal } = abort
    let lastId = '0'
    let attempt = 0
    let wake: (() => void) | null = null

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

    const snapshot = async () => {
      try {
        const session = await api.getSession(sessionId)
        if (!signal.aborted) dispatch({ type: 'event', event: snapshotEvent(session) })
      } catch (error) {
        if (!signal.aborted && isSignedOut(error)) onSignedOut()
        // Otherwise the stream (and its replay) still drives the view.
      }
    }

    const loadItems = async (): Promise<boolean> => {
      try {
        const items = await api.items(sessionId)
        if (!signal.aborted) dispatch({ type: 'items', items })
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

    const run = async () => {
      if (!(await loadItems())) return
      while (!signal.aborted) {
        let received = false
        void snapshot()
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
            setConnection('closed')
            return
          }
          if (res.ok && res.body) {
            setConnection('live')
            for await (const message of readSse(res.body)) {
              let event: OAISessionEvent
              try {
                event = JSON.parse(message.data) as OAISessionEvent
              } catch {
                continue
              }
              received = true
              if (message.id !== undefined) lastId = message.id
              dispatch({ type: 'event', ...(message.id !== undefined && { id: message.id }), event })
            }
          } else {
            await res.body?.cancel()
          }
        } catch {
          // Network failure or abort; the loop condition decides.
        }
        if (signal.aborted) return
        setConnection('reconnecting')
        if (received) attempt = 0
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

  return { state, connection, send, stop, answer }
}
