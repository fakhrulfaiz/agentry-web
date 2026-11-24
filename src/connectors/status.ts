/**
 * Connection status as the BFF reports it (`GET /api/agentry/connectors/status`),
 * and the browser side of keeping it current.
 */
import { useCallback, useEffect, useRef, useState } from 'react'

export interface ConnectionStatus {
  /** Slugs with an active account; null when unknown. */
  connected: string[] | null
  /** When Agentry last checked (epoch ms); 0 when never. */
  checkedAt: number
  /** Older than a minute; the server is checking again. */
  stale: boolean
  problem?: 'rejected' | 'unavailable'
}

/** A focused tab re-checks status older than this. */
const FOCUS_REFRESH_MS = 60_000

async function fetchStatus(refresh: boolean, signal?: AbortSignal): Promise<ConnectionStatus | null> {
  const res = await fetch(`/api/agentry/connectors/status${refresh ? '?refresh=1' : ''}`, { credentials: 'same-origin', signal })
  if (!res.ok) return null
  const body = (await res.json()) as Partial<ConnectionStatus>
  return { connected: body.connected ?? null, checkedAt: body.checkedAt ?? 0, stale: body.stale ?? false, ...(body.problem ? { problem: body.problem } : {}) }
}

/**
 * Starts from the server-rendered status, asks again only when it is missing,
 * stale or failed, and re-checks when the tab regains focus after a minute
 * (a connection made in another tab or chat then shows up).
 */
export function useConnectionStatus(initial: ConnectionStatus | undefined) {
  const [status, setStatus] = useState<ConnectionStatus | null>(initial ?? null)
  const [checking, setChecking] = useState(false)
  const latest = useRef(status)
  latest.current = status

  const load = useCallback(async (refresh: boolean, signal?: AbortSignal) => {
    setChecking(true)
    try {
      const next = await fetchStatus(refresh, signal)
      if (next) setStatus(next)
      // A stale answer means the server is refreshing; pick the result up shortly.
      if (next?.stale && !refresh) setTimeout(() => void fetchStatus(false).then((s) => s && setStatus(s)).catch(() => {}), 2_500)
    } catch {
      // Aborted or offline: keep what is shown.
    } finally {
      if (!signal?.aborted) setChecking(false)
    }
  }, [])

  useEffect(() => {
    const ctl = new AbortController()
    if (!initial || initial.stale || initial.connected === null) void load(false, ctl.signal)
    const onFocus = () => {
      const s = latest.current
      if (document.visibilityState === 'visible' && (!s || Date.now() - s.checkedAt > FOCUS_REFRESH_MS)) void load(false)
    }
    document.addEventListener('visibilitychange', onFocus)
    window.addEventListener('focus', onFocus)
    return () => {
      ctl.abort()
      document.removeEventListener('visibilitychange', onFocus)
      window.removeEventListener('focus', onFocus)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the initial status is read once
  }, [load])

  return { status, checking, refresh: () => load(true) }
}

/** "Checked just now" / "Checked 4 min ago" / "Checked 2 h ago". */
export function checkedLabel(checkedAt: number, now = Date.now()): string {
  const minutes = Math.floor((now - checkedAt) / 60_000)
  if (minutes < 1) return 'Checked just now'
  if (minutes < 60) return `Checked ${minutes} min ago`
  return `Checked ${Math.floor(minutes / 60)} h ago`
}
