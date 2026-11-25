import 'server-only'
import { createHash } from 'node:crypto'
import type { ConnectedInventory } from './connector-inventory'

/** Why connection status is unknown: Composio refused the key, or could not be reached. */
export type ConnectionProblem = 'rejected' | 'unavailable'

export type LoadResult = { ok: true; inventory: ConnectedInventory } | { ok: false; reason: ConnectionProblem }

/** What the cache knows about one owner's connections. */
export interface ConnectionSnapshot {
  /** Accounts per app; null when never loaded successfully. */
  inventory: ConnectedInventory | null
  /** When `inventory` was checked (epoch ms); 0 when never. */
  checkedAt: number
  /** True when older than the fresh window; a background refresh is under way. */
  stale: boolean
  /** Set when the last check failed. */
  problem?: ConnectionProblem
}

interface Entry {
  keyHash: string
  inventory: ConnectedInventory | null
  checkedAt: number
  problem?: ConnectionProblem
  failedAt?: number
  inflight?: Promise<void>
}

export interface ConnectionCacheOptions {
  load: (key: string, slugs: string[]) => Promise<LoadResult>
  now?: () => number
  /** Answers younger than this are served without checking. */
  freshMs?: number
  /** Answers younger than this are served at once while a refresh runs. */
  staleMs?: number
  /** A failed check is not retried for this long. */
  failureMs?: number
}

/**
 * Per-owner Composio connection status, stale-while-revalidate: a page never
 * waits on Composio when any recent answer exists, callers share one request,
 * failures are remembered briefly (so a refused key does not slow every page),
 * and a failed refresh keeps the last good answer.
 */
const hashOf = (key: string) => createHash('sha256').update(key).digest('hex')

export function createConnectionCache(options: ConnectionCacheOptions) {
  const { load, now = Date.now, freshMs = 60_000, staleMs = 24 * 3_600_000, failureMs = 60_000 } = options
  const entries = new Map<string, Entry>()

  const snapshot = (entry: Entry): ConnectionSnapshot => ({
    inventory: entry.inventory,
    checkedAt: entry.checkedAt,
    stale: entry.inventory !== null && now() - entry.checkedAt >= freshMs,
    ...(entry.problem ? { problem: entry.problem } : {}),
  })

  function refresh(owner: string, entry: Entry, key: string, slugs: string[]): Promise<void> {
    entry.inflight ??= load(key, slugs)
      .catch((): LoadResult => ({ ok: false, reason: 'unavailable' }))
      .then((result) => {
        const at = now()
        if (result.ok) Object.assign(entry, { inventory: result.inventory, checkedAt: at, problem: undefined, failedAt: undefined })
        else Object.assign(entry, { problem: result.reason, failedAt: at })
      })
      .finally(() => {
        entry.inflight = undefined
      })
    return entry.inflight
  }

  return {
    async get(owner: string, key: string, slugs: string[], opts: { force?: boolean } = {}): Promise<ConnectionSnapshot> {
      const keyHash = hashOf(key)
      let entry = entries.get(owner)
      if (!entry || entry.keyHash !== keyHash) {
        entry = { keyHash, inventory: null, checkedAt: 0 }
        entries.set(owner, entry)
      }
      const t = now()
      const recentFailure = entry.failedAt !== undefined && t - entry.failedAt < failureMs
      if (opts.force) {
        await refresh(owner, entry, key, slugs)
      } else if (entry.inventory !== null && t - entry.checkedAt < staleMs) {
        if (t - entry.checkedAt >= freshMs && !recentFailure) void refresh(owner, entry, key, slugs)
      } else if (!recentFailure) {
        await refresh(owner, entry, key, slugs)
      }
      return snapshot(entry)
    },
    /** The owner's snapshot for `key` without checking anything; undefined when never asked with that key. */
    peek(owner: string, key: string): ConnectionSnapshot | undefined {
      const entry = entries.get(owner)
      return entry && entry.keyHash === hashOf(key) ? snapshot(entry) : undefined
    },
    forget(owner: string): void {
      entries.delete(owner)
    },
  }
}
