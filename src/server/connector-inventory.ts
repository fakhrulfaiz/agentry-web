import 'server-only'
import { listConnections } from './connector-status'

/** One connected account of an app. */
export interface ConnectedAccount {
  id: string
  alias: string | null
  status: string
}

/** App slug to whether one account is active, and its accounts. */
export type ConnectedInventory = Record<string, { connected: boolean; accounts: ConnectedAccount[] }>

const CACHE_MS = 60_000

/**
 * Accounts per app from a `COMPOSIO_MANAGE_CONNECTIONS` list result.
 * @throws when the call did not succeed, so callers can tell "none" from "unknown".
 */
export function parseAccounts(message: unknown): ConnectedInventory {
  const rpc = message as { error?: unknown; result?: { isError?: boolean; content?: { text?: unknown }[] } }
  const text = rpc.result?.content?.[0]?.text
  if (rpc.error || rpc.result?.isError || typeof text !== 'string') throw new Error('list call failed')
  const payload = JSON.parse(text) as { successful?: boolean; data?: { results?: Record<string, { accounts?: { id?: unknown; alias?: unknown; status?: unknown }[] }> } }
  if (!payload.successful || !payload.data?.results) throw new Error('list call unsuccessful')
  const out: ConnectedInventory = {}
  for (const [slug, result] of Object.entries(payload.data.results)) {
    const accounts = (result.accounts ?? []).map((a) => ({
      id: typeof a.id === 'string' ? a.id : '',
      alias: typeof a.alias === 'string' ? a.alias : null,
      status: typeof a.status === 'string' ? a.status : 'unknown',
    }))
    out[slug] = { connected: accounts.some((a) => a.status === 'active'), accounts }
  }
  return out
}

const cache = new Map<string, { at: number; value: ConnectedInventory }>()

/**
 * The owner's accounts per app, cached for a minute; `null` when unknown (failures are not cached).
 * @param now - clock in epoch milliseconds, injectable in tests.
 */
export async function connectedAccounts(owner: string, key: string, slugs: string[], now = Date.now()): Promise<ConnectedInventory | null> {
  const hit = cache.get(owner)
  if (hit && now - hit.at < CACHE_MS) return hit.value
  const message = await listConnections(key, slugs)
  if (message === null) return null
  try {
    const value = parseAccounts(message)
    cache.set(owner, { at: now, value })
    return value
  } catch {
    return null
  }
}

/** Drops the owner's cached inventory; call when their key is replaced or removed. */
export function forgetConnectedAccounts(owner: string): void {
  cache.delete(owner)
}
