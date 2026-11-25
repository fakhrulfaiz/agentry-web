'use client'

/**
 * The last data each page loaded, kept in memory for this tab. Opening a page
 * again shows it at once and refreshes it in the background, instead of a
 * skeleton on every visit. It is never read on the server (that module is
 * shared by every user), and a reload or sign-out (a full page load) clears it.
 */
import { useEffect, useState, type Dispatch, type SetStateAction } from 'react'

const store = new Map<string, unknown>()

export function cached<T>(key: string): T | undefined {
  if (typeof window === 'undefined') return undefined
  return store.get(key) as T | undefined
}

export function remember<T>(key: string, value: T): T {
  if (typeof window !== 'undefined') store.set(key, value)
  return value
}

/** For tests: start each one with nothing remembered. */
export function clearPageCache(): void {
  store.clear()
}

/**
 * `useState` that starts from the value this key last held and remembers every
 * new non-null value: a page opened again renders its last data while it reloads.
 */
export function useCachedState<T>(key: string): [T | null, Dispatch<SetStateAction<T | null>>] {
  const [value, setValue] = useState<T | null>(() => cached<T>(key) ?? null)
  useEffect(() => {
    if (value !== null) remember(key, value)
  }, [key, value])
  return [value, setValue]
}
