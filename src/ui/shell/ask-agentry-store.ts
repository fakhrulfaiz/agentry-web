'use client'

/**
 * The global Ask Agentry drawer: whether it is open and which helper chat it
 * holds. The session id survives a reload in localStorage; the open state does
 * not. `reset()` is for tests (it drops memory but keeps storage, to simulate
 * a reload).
 */
import { useSyncExternalStore } from 'react'

export type AskAgentryState = { isOpen: boolean; sessionId: string | null }

const KEY = 'agentry_ask_session'
const EMPTY: AskAgentryState = { isOpen: false, sessionId: null }

let state: AskAgentryState = EMPTY
let hydrated = false
const listeners = new Set<() => void>()

function emit() {
  for (const listener of listeners) listener()
}

function hydrate() {
  if (hydrated || typeof window === 'undefined') return
  hydrated = true
  try {
    const saved = window.localStorage.getItem(KEY)
    if (saved) state = { ...state, sessionId: saved }
  } catch {
    // Storage can be unavailable (private browsing); the drawer still works.
  }
}

function update(next: AskAgentryState) {
  if (next.isOpen === state.isOpen && next.sessionId === state.sessionId) return
  state = next
  emit()
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

function snapshot(): AskAgentryState {
  hydrate()
  return state
}

function serverSnapshot(): AskAgentryState {
  return EMPTY
}

export const askAgentryStore = {
  /** Subscribe to the drawer's state from a component. */
  use(): AskAgentryState {
    return useSyncExternalStore(subscribe, snapshot, serverSnapshot)
  },
  get(): AskAgentryState {
    return snapshot()
  },
  open(): void {
    hydrate()
    update({ ...state, isOpen: true })
  },
  close(): void {
    update({ ...state, isOpen: false })
  },
  setSession(id: string | null): void {
    hydrate()
    try {
      if (id) window.localStorage.setItem(KEY, id)
      else window.localStorage.removeItem(KEY)
    } catch {
      // Losing the restored session after a reload is acceptable.
    }
    update({ ...state, sessionId: id })
  },
  reset(): void {
    state = EMPTY
    hydrated = false
    emit()
  },
}
