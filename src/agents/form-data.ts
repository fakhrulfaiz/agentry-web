/**
 * What the agent editor needs besides the agent itself, cached briefly so
 * opening the editor again does not wait on the same requests.
 */
import { api } from '@/api/client'
import { memoize } from '@/api/memo'
import type { HostToolInfo } from '@/api/types'

async function fetchConnectedApps(): Promise<string[] | null> {
  try {
    const res = await fetch('/api/agentry/connectors/status', { credentials: 'same-origin' })
    return res.ok ? (((await res.json()) as { connected?: string[] | null }).connected ?? null) : null
  } catch {
    return null
  }
}

export const modelsMemo = memoize(() => api.models(), 60_000)
export const hostToolsMemo = memoize<HostToolInfo[]>(() => api.listHostTools().catch(() => []), 5 * 60_000)
export const connectedAppsMemo = memoize(fetchConnectedApps, 30_000)
