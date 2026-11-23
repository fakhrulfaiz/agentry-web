/**
 * In-memory lists for the `/` menu, one per chat (key = session id; `''` is
 * the list without a chat). A loader fetches a key in the background and
 * again on window focus, at most once per `REFRESH_MS` per key. A failed fetch
 * keeps the previous list (empty at first), so a group stays hidden with no
 * error shown.
 */
import { useEffect, useSyncExternalStore } from 'react'

export const REFRESH_MS = 60_000

interface Entry<T> {
  list: T[]
  lastAttempt: number
  inFlight: boolean
}

/** The store functions for one kind of list. */
export interface KeyedStore<T> {
  /** Replaces the list of `key` and notifies readers. */
  set(next: T[], key?: string): void
  /** Empties every list and refresh timer (tests). */
  reset(): void
  /** Fetches `key` unless a fetch runs or the last attempt is under `REFRESH_MS` old. Never throws. */
  refresh(key?: string, now?: number): Promise<void>
  /** Refetches every key loaded so far, ignoring the throttle (the lists changed elsewhere). Never throws. */
  invalidate(): Promise<void>
  /** The list of `key`; empty until loaded or when loading failed. */
  useList(key?: string): T[]
  /** Loads `key` on mount, when it changes, and when the window regains focus (throttled). */
  useLoader(key?: string): void
}

/**
 * @param fetchList - loads the list of a key (`undefined` for the no-chat key).
 * @param enabled - whether a key has anything to load (default: always).
 */
export function createKeyedStore<T>(fetchList: (key: string | undefined) => Promise<T[]>, enabled: (key: string | undefined) => boolean = () => true): KeyedStore<T> {
  const EMPTY: T[] = []
  const entries = new Map<string, Entry<T>>()
  const listeners = new Set<() => void>()
  const entry = (key: string): Entry<T> => {
    let found = entries.get(key)
    if (!found) {
      found = { list: EMPTY, lastAttempt: 0, inFlight: false }
      entries.set(key, found)
    }
    return found
  }
  const notify = () => {
    for (const listener of listeners) listener()
  }
  const set = (next: T[], key = '') => {
    entry(key).list = next
    notify()
  }
  const refresh = async (key = '', now: number = Date.now()) => {
    const e = entry(key)
    if (!enabled(key || undefined) || e.inFlight || (e.lastAttempt !== 0 && now - e.lastAttempt < REFRESH_MS)) return
    e.inFlight = true
    e.lastAttempt = now
    try {
      set(await fetchList(key || undefined), key)
    } catch {
      // The menu groups are optional: the list stays as it was, with no error shown.
    } finally {
      e.inFlight = false
    }
  }
  const subscribe = (listener: () => void) => {
    listeners.add(listener)
    return () => listeners.delete(listener)
  }
  return {
    set,
    reset: () => {
      entries.clear()
      notify()
    },
    refresh,
    invalidate: async () => {
      const keys = [...entries.keys()]
      for (const key of keys) entry(key).lastAttempt = 0
      await Promise.all(keys.map((key) => refresh(key)))
    },
    useList: (key = '') => useSyncExternalStore(subscribe, () => entries.get(key)?.list ?? EMPTY, () => EMPTY),
    useLoader: (key = '') => {
      useEffect(() => {
        void refresh(key)
        const onFocus = () => void refresh(key)
        window.addEventListener('focus', onFocus)
        return () => window.removeEventListener('focus', onFocus)
      }, [key])
    },
  }
}
