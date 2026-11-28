'use client'

/**
 * The live view of the agent's browser (`GET /agents/sessions/{id}/browser/live` through the BFF): the
 * newest frame while the agent's browser is open, or why there is nothing to show, and whether the user
 * has control (`control` events). The stream is closed while the page is hidden, and with reduced motion
 * at most one frame a second is shown. Each frame is decoded before it replaces the shown one, so frames
 * swap without a blank flash.
 */
import { useEffect, useState } from 'react'
import { usePrefersReducedMotion } from '@/ui/chat/use-reduced-motion'
import type { ControlEndReason } from '@/chat/browser-input'

/** Why no frames come; see the API's `idle` event. */
export type BrowserIdleReason = 'not_started' | 'no_browser' | 'browser_off' | 'not_sandbox'

export interface LiveFrame {
  /** A `data:image/jpeg` URL. */
  src: string
  url: string
  title: string
  /** The page's size in CSS pixels, when known. */
  width?: number
  height?: number
}

/** The newest `control` event: whether the user has control, and why it ended. */
export interface LiveControl {
  controlled: boolean
  reason?: ControlEndReason
}

/** The agent's pointer in the page's CSS pixels; `at` is when it arrived (a new value for each event). */
export interface LivePointer {
  x: number
  y: number
  action: 'move' | 'down' | 'up'
  at: number
}

/** The field the page just focused, in the page's CSS pixels. */
export interface LiveFocus {
  x: number
  y: number
  width: number
  height: number
  at: number
}

const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)

/** Parses a `pointer` event's data; `undefined` when it is not one. */
export function parsePointer(data: string, at: number): LivePointer | undefined {
  let m: { action?: unknown; x?: unknown; y?: unknown }
  try { m = JSON.parse(data) as typeof m } catch { return undefined }
  if (!m || (m.action !== 'move' && m.action !== 'down' && m.action !== 'up') || !finite(m.x) || !finite(m.y)) return undefined
  return { x: m.x, y: m.y, action: m.action, at }
}

/** Parses a `focus` event's data; `undefined` when it is not one. */
export function parseFocus(data: string, at: number): LiveFocus | undefined {
  let m: { x?: unknown; y?: unknown; width?: unknown; height?: unknown }
  try { m = JSON.parse(data) as typeof m } catch { return undefined }
  if (!m || !finite(m.x) || !finite(m.y) || !finite(m.width) || !finite(m.height)) return undefined
  return { x: m.x, y: m.y, width: m.width, height: m.height, at }
}

/** Decodes a frame image off-screen; `undefined` where decoding is not available (then it is shown at once). */
function decoding(src: string): Promise<void> | undefined {
  if (typeof Image === 'undefined') return undefined
  const img = new Image()
  if (typeof img.decode !== 'function') return undefined
  img.src = src
  return img.decode().catch(() => undefined)
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
export function useBrowserLive(sessionId: string | null): BrowserLive & { control?: LiveControl; pointer?: LivePointer; focus?: LiveFocus } {
  const [live, setLive] = useState<BrowserLive>({ status: 'connecting' })
  const [pointer, setPointer] = useState<LivePointer | undefined>(undefined)
  const [focus, setFocus] = useState<LiveFocus | undefined>(undefined)
  const [control, setControl] = useState<LiveControl | undefined>(undefined)
  const visible = useDocumentVisible()
  const reduced = usePrefersReducedMotion()
  useEffect(() => {
    if (sessionId === null || !visible || typeof EventSource === 'undefined') return
    const source = new EventSource(browserLiveUrl(sessionId))
    let lastShown = 0
    let pending: LiveFrame | undefined
    let timer: ReturnType<typeof setTimeout> | undefined
    let seq = 0
    let shownSeq = 0
    let closed = false
    let shownUrl: string | undefined
    const clearCursor = () => { setPointer(undefined); setFocus(undefined) }
    const show = (frame: LiveFrame) => {
      lastShown = Date.now()
      const n = ++seq
      const apply = () => {
        // A later frame that decoded first wins; an older one is dropped.
        if (closed || n < shownSeq) return
        shownSeq = n
        // A focus outline belongs to the page it was seen on. The arrow stays: most agent clicks follow a link,
        // and the new page's first frame comes a moment after the click, so clearing it here hid nearly every
        // click. It still hides three seconds after the last pointer event.
        if (shownUrl !== undefined && shownUrl !== frame.url) setFocus(undefined)
        shownUrl = frame.url
        setLive({ status: 'live', frame })
      }
      const pendingDecode = decoding(frame.src)
      if (pendingDecode) void pendingDecode.then(apply)
      else apply()
    }
    source.addEventListener('frame', (event) => {
      let msg: { data?: unknown; url?: unknown; title?: unknown; width?: unknown; height?: unknown }
      try { msg = JSON.parse((event as MessageEvent<string>).data) as typeof msg } catch { return }
      if (typeof msg.data !== 'string' || msg.data === '') return
      const size = typeof msg.width === 'number' && typeof msg.height === 'number' && msg.width > 0 && msg.height > 0 ? { width: msg.width, height: msg.height } : {}
      const frame: LiveFrame = { src: `data:image/jpeg;base64,${msg.data}`, url: typeof msg.url === 'string' ? msg.url : '', title: typeof msg.title === 'string' ? msg.title : '', ...size }
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
      shownUrl = undefined
      clearCursor()
      setLive({ status: 'idle', reason: REASONS.has(reason as BrowserIdleReason) ? reason as BrowserIdleReason : 'not_started' })
    })
    source.addEventListener('pointer', (event) => {
      const next = parsePointer((event as MessageEvent<string>).data, Date.now())
      if (next) setPointer(next)
    })
    source.addEventListener('focus', (event) => {
      const next = parseFocus((event as MessageEvent<string>).data, Date.now())
      if (next) setFocus(next)
    })
    // A reconnect may have missed events: start without a cursor.
    source.addEventListener('open', () => { shownUrl = undefined; clearCursor() })
    source.addEventListener('control', (event) => {
      let msg: { controlled?: unknown; reason?: unknown }
      try { msg = JSON.parse((event as MessageEvent<string>).data) as typeof msg } catch { return }
      if (typeof msg.controlled !== 'boolean') return
      setControl({ controlled: msg.controlled, ...(typeof msg.reason === 'string' ? { reason: msg.reason as ControlEndReason } : {}) })
    })
    source.addEventListener('error', (event) => {
      // A server `error` event (it carries data) ends the view; a dropped connection reconnects by itself.
      if ((event as MessageEvent<string>).data === undefined) return
      source.close()
      setLive({ status: 'unavailable' })
    })
    return () => {
      closed = true
      source.close()
      if (timer !== undefined) clearTimeout(timer)
    }
  }, [sessionId, visible, reduced])
  return { ...live, ...(control ? { control } : {}), ...(pointer ? { pointer } : {}), ...(focus ? { focus } : {}) }
}
