/**
 * A short-lived client cache for one slow, rarely changing request (the
 * model list, the tool catalog). Callers that ask at the same time share one
 * request; a failure is never kept.
 */
export interface Memo<T> {
  get(): Promise<T>
  clear(): void
}

/**
 * @param load - the request.
 * @param ttlMs - how long an answer is reused.
 * @param now - clock, for tests.
 */
export function memoize<T>(load: () => Promise<T>, ttlMs: number, now: () => number = Date.now): Memo<T> {
  let entry: { at: number; value: Promise<T> } | null = null
  return {
    get() {
      if (entry && now() - entry.at < ttlMs) return entry.value
      const value = load()
      const mine = { at: now(), value }
      entry = mine
      value.catch(() => {
        if (entry === mine) entry = null
      })
      return value
    },
    clear() {
      entry = null
    },
  }
}
