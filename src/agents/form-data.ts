/**
 * What the agent editor needs besides the agent itself, cached briefly so
 * opening the editor again does not wait on the same requests.
 */
import { api } from '@/api/client'
import { memoize } from '@/api/memo'
import type { HostToolInfo } from '@/api/types'

/** Throws on failure so the memo does not keep it; callers fall back to "unknown". */
async function fetchConnectedApps(): Promise<string[] | null> {
  const res = await fetch('/api/agentry/connectors/status', { credentials: 'same-origin' })
  if (!res.ok) throw new Error(`status ${String(res.status)}`)
  return ((await res.json()) as { connected?: string[] | null }).connected ?? null
}

export const modelsMemo = memoize(() => api.models(), 60_000)
export const hostToolsMemo = memoize<HostToolInfo[]>(() => api.listHostTools(), 5 * 60_000)
export const connectedAppsMemo = memoize(fetchConnectedApps, 30_000)
