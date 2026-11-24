import 'server-only'
import { listConnectionsResult } from './connector-status'
import type { LoadResult } from './connection-cache'

/** One connected account of an app. */
export interface ConnectedAccount {
  id: string
  alias: string | null
  status: string
}

/** App slug to whether one account is active, and its accounts. */
export type ConnectedInventory = Record<string, { connected: boolean; accounts: ConnectedAccount[] }>

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

/** Accounts per app for `slugs`, or why they could not be read. */
export async function loadInventory(key: string, slugs: string[]): Promise<LoadResult> {
  const result = await listConnectionsResult(key, slugs)
  if (!result.ok) return result
  try {
    return { ok: true, inventory: parseAccounts(result.message) }
  } catch {
    return { ok: false, reason: 'unavailable' }
  }
}

/** Slugs with an active account. */
export function connectedSlugs(inventory: ConnectedInventory): string[] {
  return Object.entries(inventory).flatMap(([slug, app]) => (app.connected ? [slug] : []))
}
