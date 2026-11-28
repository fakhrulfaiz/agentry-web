import 'server-only'
import { agentryHeaders, agentryUrl } from './agentry'
import type { ConnectedInventory } from './connector-inventory'
import type { LoadResult } from './connection-cache'

/** What the API says about the user's Composio key; the key itself never comes back. */
export interface ConnectorKeyStatus {
  configured: boolean
  last4: string | null
  updated_at: number | null
}

/** An API answer that is not a key status: its status and error code (e.g. `invalid_key`, `secrets_disabled`). */
export class ConnectorKeyError extends Error {
  constructor(readonly status: number, readonly code: string) {
    super(code)
    this.name = 'ConnectorKeyError'
  }
}

const PATH = '/agents/connectors/composio'

async function call(authorization: string, method: 'GET' | 'POST' | 'DELETE', body?: unknown): Promise<ConnectorKeyStatus> {
  const res = await fetch(agentryUrl(PATH), {
    method,
    headers: agentryHeaders(authorization, { accept: 'application/json', ...(body ? { 'content-type': 'application/json' } : {}) }),
    body: body ? JSON.stringify(body) : undefined,
    cache: 'no-store',
  })
  const data = (await res.json().catch(() => null)) as (Partial<ConnectorKeyStatus> & { error?: { code?: string } }) | null
  if (!res.ok) throw new ConnectorKeyError(res.status, data?.error?.code ?? 'upstream_error')
  return { configured: data?.configured === true, last4: data?.last4 ?? null, updated_at: data?.updated_at ?? null }
}

/** The signed-in user's key status, read from the API. */
export const keyStatus = (authorization: string) => call(authorization, 'GET')
/** Sends the key to the API, which seals and stores it under the caller's owner. */
export const saveKey = (authorization: string, key: string) => call(authorization, 'POST', { key })
/** Removes the caller's key in the API. */
export const removeKey = (authorization: string) => call(authorization, 'DELETE')

/** Accounts per app for `slugs`, read by the API with the caller's stored key. */
export async function loadConnections(authorization: string, slugs: string[]): Promise<LoadResult> {
  try {
    // POST: the whole catalog is too long for a query string.
    const res = await fetch(agentryUrl(`${PATH}/connections`), {
      method: 'POST',
      headers: agentryHeaders(authorization, { accept: 'application/json', 'content-type': 'application/json' }),
      body: JSON.stringify({ toolkits: slugs }),
      cache: 'no-store',
    })
    const data = (await res.json().catch(() => null)) as { data?: ConnectedInventory; error?: { reason?: string } } | null
    if (res.ok && data?.data) return { ok: true, inventory: data.data }
    return { ok: false, reason: data?.error?.reason === 'rejected' ? 'rejected' : 'unavailable' }
  } catch {
    return { ok: false, reason: 'unavailable' }
  }
}

/**
 * The user's key status, moving a key left in the web app's old file store (`connectors-store`)
 * into the API first: when the API has none and the file has one, it is sent with the user's own
 * credential (so it lands under the API's owner for that credential, e.g. `dev` in apikey mode)
 * and the file entry is deleted. If the API refuses, the file entry stays and the API's status is returned.
 * @param fileSlot - the user's slot in the file store (`ownerOf(identity)`).
 */
export async function currentKeyStatus(fileSlot: string, authorization: string): Promise<ConnectorKeyStatus> {
  const status = await keyStatus(authorization)
  if (status.configured) return status
  const { getKey, removeKey: removeFileKey } = await import('./connectors-store')
  let legacy: string | undefined
  try {
    legacy = await getKey(fileSlot)
  } catch {
    return status
  }
  if (!legacy) return status
  try {
    const moved = await saveKey(authorization, legacy)
    await removeFileKey(fileSlot)
    return moved
  } catch {
    return status
  }
}
