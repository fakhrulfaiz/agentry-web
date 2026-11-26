'use client'

/**
 * The live view of the agent's browser (`GET /agents/sessions/{id}/browser/live` through the BFF): the
 * newest frame while the agent's browser is open, or why there is nothing to show. The stream is closed
 * while the page is hidden, and with reduced motion at most one frame a second is shown.
 */
import { useEffect, useState } from 'react'
import { usePrefersReducedMotion } from '@/ui/chat/use-reduced-motion'

/** Why no frames come; see the API's `idle` event. */
export type BrowserIdleReason = 'not_started' | 'no_browser' | 'browser_off' | 'not_sandbox'

export interface LiveFrame {
  /** A `data:image/jpeg` URL. */
  src: string
  url: string
  title: string
}

export type BrowserLive =
  | { status: 'connecting' }
  | { status: 'live'; frame: LiveFrame }
  | { status: 'idle'; reason: BrowserIdleReason }
  /** The stream could not be opened (for example too many live views). */
  | { status: 'unavailable' }

const REASONS = new Set<BrowserIdleReason>(['not_started', 'no_browser', 'browser_off', 'not_sandbox'])
/** Least time between two shown frames with reduced motion. */
export const REDUCED_MOTION_FRAME_MS = 1000

export function browserLiveUrl(sessionId: string): string {
  return `/api/agentry/agents/sessions/${encodeURIComponent(sessionId)}/browser/live`
}

function useDocumentVisible(): boolean {
  const [visible, setVisible] = useState(() => typeof document === 'undefined' || document.visibilityState !== 'hidden')
  useEffect(() => {
    const onChange = () => { setVisible(document.visibilityState !== 'hidden') }
    document.addEventListener('visibilitychange', onChange)
    return () => { document.removeEventListener('visibilitychange', onChange) }
  }, [])
  return visible
}

/** The live view of `sessionId`'s browser; `null` turns it off. */
export function useBrowserLive(sessionId: string | null): BrowserLive {
  const [live, setLive] = useState<BrowserLive>({ status: 'connecting' })
  const visible = useDocumentVisible()
  const reduced = usePrefersReducedMotion()
  useEffect(() => {
    if (sessionId === null || !visible || typeof EventSource === 'undefined') return
    const source = new EventSource(browserLiveUrl(sessionId))
    let lastShown = 0
    let pending: LiveFrame | undefined
    let timer: ReturnType<typeof setTimeout> | undefined
    const show = (frame: LiveFrame) => {
      lastShown = Date.now()
      setLive({ status: 'live', frame })
    }
    source.addEventListener('frame', (event) => {
      let msg: { data?: unknown; url?: unknown; title?: unknown }
      try { msg = JSON.parse((event as MessageEvent<string>).data) as typeof msg } catch { return }
      if (typeof msg.data !== 'string' || msg.data === '') return
      const frame: LiveFrame = { src: `data:image/jpeg;base64,${msg.data}`, url: typeof msg.url === 'string' ? msg.url : '', title: typeof msg.title === 'string' ? msg.title : '' }
      if (!reduced) { show(frame); return }
      // Reduced motion: at most one frame a second, always ending on the newest.
      const wait = lastShown + REDUCED_MOTION_FRAME_MS - Date.now()
      if (wait <= 0 && timer === undefined) { show(frame); return }
      pending = frame
      timer ??= setTimeout(() => {
        timer = undefined
        if (pending) show(pending)
        pending = undefined
      }, Math.max(0, wait))
    })
    source.addEventListener('idle', (event) => {
      let reason: unknown
      try { reason = (JSON.parse((event as MessageEvent<string>).data) as { reason?: unknown }).reason } catch { reason = undefined }
      pending = undefined
      setLive({ status: 'idle', reason: REASONS.has(reason as BrowserIdleReason) ? reason as BrowserIdleReason : 'not_started' })
    })
    source.addEventListener('error', (event) => {
      // A server `error` event (it carries data) ends the view; a dropped connection reconnects by itself.
      if ((event as MessageEvent<string>).data === undefined) return
      source.close()
      setLive({ status: 'unavailable' })
    })
    return () => {
      source.close()
      if (timer !== undefined) clearTimeout(timer)
    }
  }, [sessionId, visible, reduced])
  return live
}
