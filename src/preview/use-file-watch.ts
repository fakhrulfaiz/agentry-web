import { useEffect, useRef } from 'react'

/** Subscribes to workspace artifact changes; reconnects with backoff, stops on `closed` until re-enabled. */
export function useFileWatch(sessionId: string, enabled: boolean, onChange: (paths: string[] | 'reset') => void): void {
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange

  useEffect(() => {
    if (!enabled) return
    let es: EventSource | null = null
    let timer: ReturnType<typeof setTimeout> | undefined
    let attempt = 0
    let closedByServer = false

    const open = () => {
      if (closedByServer) return
      es = new EventSource(`/api/agentry/agents/sessions/${encodeURIComponent(sessionId)}/artifacts/watch`)
      es.addEventListener('changed', (ev: MessageEvent) => {
        attempt = 0
        try {
          const data = JSON.parse(ev.data as string) as { paths?: unknown }
          onChangeRef.current(Array.isArray(data.paths) ? data.paths.filter((p): p is string => typeof p === 'string') : [])
        } catch {}
      })
      es.addEventListener('reset', () => {
        attempt = 0
        onChangeRef.current('reset')
      })
      es.addEventListener('closed', () => {
        closedByServer = true
        es?.close()
        es = null
      })
      es.onerror = () => {
        es?.close()
        es = null
        if (closedByServer) return
        const delay = Math.min(30_000, 1000 * 2 ** attempt)
        attempt += 1
        timer = setTimeout(open, delay)
      }
    }

    open()
    return () => {
      closedByServer = true
      if (timer !== undefined) clearTimeout(timer)
      es?.close()
    }
  }, [sessionId, enabled])
}
