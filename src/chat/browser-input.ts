'use client'

/**
 * Browser take-over in the Browser tab: map the user's pointer, wheel and keys on the shown frame to the
 * API's input events (page CSS pixels, `POST .../browser/input`), batch them, and hold or hand back
 * control (`POST .../browser/control`). Control is handed back when the tab is hidden or the chat closes.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { api, ApiError } from '@/api/client'

export type BrowserInputEvent =
  | { type: 'mouse'; action: 'move' | 'down' | 'up'; x: number; y: number; button?: 'left' | 'middle' | 'right'; buttons?: number; click_count?: number; modifiers?: number }
  | { type: 'wheel'; x: number; y: number; delta_x: number; delta_y: number; modifiers?: number }
  | { type: 'key'; action: 'down' | 'up'; key: string; code?: string; key_code?: number; text?: string; modifiers?: number }
  | { type: 'text'; text: string }
  | { type: 'resize'; width: number; height: number }

export interface BrowserControlGrant {
  control_id: string
  since: number
  idle_timeout_seconds: number
}

/** Why control ended, as the live stream's `control` event says. */
export type ControlEndReason = 'released' | 'idle' | 'left' | 'taken' | 'closed'

/** Where a frame is shown on screen, and the page size it stands for (CSS pixels). */
export interface FrameBox {
  left: number
  top: number
  width: number
  height: number
  pageWidth: number
  pageHeight: number
}

/**
 * The page point under a client point. The frame is drawn to fit its box (`object-fit: contain`), so
 * letterboxing is taken off first. `undefined` outside the drawn frame.
 */
export function toPagePoint(clientX: number, clientY: number, box: FrameBox): { x: number; y: number } | undefined {
  if (box.width <= 0 || box.height <= 0 || box.pageWidth <= 0 || box.pageHeight <= 0) return undefined
  const scale = Math.min(box.width / box.pageWidth, box.height / box.pageHeight)
  const drawnW = box.pageWidth * scale
  const drawnH = box.pageHeight * scale
  const x = (clientX - box.left - (box.width - drawnW) / 2) / scale
  const y = (clientY - box.top - (box.height - drawnH) / 2) / scale
  if (x < 0 || y < 0 || x > box.pageWidth || y > box.pageHeight) return undefined
  return { x: Math.round(x * 100) / 100, y: Math.round(y * 100) / 100 }
}

/**
 * The client point where a page point is drawn, the inverse of `toPagePoint` (same letterbox maths).
 * `undefined` when the page point is outside the page or the box is empty.
 */
export function toFramePoint(pageX: number, pageY: number, box: FrameBox): { x: number; y: number } | undefined {
  if (box.width <= 0 || box.height <= 0 || box.pageWidth <= 0 || box.pageHeight <= 0) return undefined
  if (pageX < 0 || pageY < 0 || pageX > box.pageWidth || pageY > box.pageHeight) return undefined
  const scale = Math.min(box.width / box.pageWidth, box.height / box.pageHeight)
  const drawnW = box.pageWidth * scale
  const drawnH = box.pageHeight * scale
  return { x: box.left + (box.width - drawnW) / 2 + pageX * scale, y: box.top + (box.height - drawnH) / 2 + pageY * scale }
}

/** CDP modifier bits: Alt 1, Ctrl 2, Meta 4, Shift 8. */
export function modifiersOf(e: { altKey: boolean; ctrlKey: boolean; metaKey: boolean; shiftKey: boolean }): number {
  return (e.altKey ? 1 : 0) | (e.ctrlKey ? 2 : 0) | (e.metaKey ? 4 : 0) | (e.shiftKey ? 8 : 0)
}

const BUTTON = ['left', 'middle', 'right'] as const

/** A key press or release as an input event. A key that types (one character, Enter) carries its text, unless it belongs to an IME composition. */
export function keyEvent(e: { key: string; code: string; keyCode: number; altKey: boolean; ctrlKey: boolean; metaKey: boolean; shiftKey: boolean }, action: 'down' | 'up', composing = false): BrowserInputEvent {
  const modifiers = modifiersOf(e)
  const types = action === 'down' && !e.ctrlKey && !e.metaKey && !composing
  const text = !types ? undefined : e.key === 'Enter' ? '\r' : [...e.key].length === 1 ? e.key : undefined
  return {
    type: 'key', action, key: e.key.slice(0, 32),
    ...(e.code ? { code: e.code.slice(0, 32) } : {}),
    ...(e.keyCode ? { key_code: e.keyCode } : {}),
    ...(text !== undefined ? { text } : {}),
    ...(modifiers ? { modifiers } : {}),
  }
}

/** Mouse event fields for a pointer event, or `undefined` outside the frame. */
export function mouseEvent(e: { clientX: number; clientY: number; button: number; buttons: number; detail: number; altKey: boolean; ctrlKey: boolean; metaKey: boolean; shiftKey: boolean }, action: 'move' | 'down' | 'up', box: FrameBox): BrowserInputEvent | undefined {
  const point = toPagePoint(e.clientX, e.clientY, box)
  if (!point) return undefined
  const modifiers = modifiersOf(e)
  const button = action === 'move' ? undefined : BUTTON[e.button]
  return {
    type: 'mouse', action, ...point,
    ...(button ? { button } : {}),
    buttons: e.buttons,
    ...(action !== 'move' ? { click_count: Math.min(3, Math.max(1, e.detail || 1)) } : {}),
    ...(modifiers ? { modifiers } : {}),
  }
}

/** The committed text of an IME composition as one input event; nothing when the composition was cancelled. */
export function composedTextEvent(data: string): { type: 'text'; text: string } | undefined {
  if (data === '') return undefined
  return { type: 'text', text: data.slice(0, 2000) }
}

/** A one-finger drag as a wheel event in page pixels; nothing when either point is outside the drawn frame. */
export function wheelFromTouch(from: { clientX: number; clientY: number }, to: { clientX: number; clientY: number }, box: FrameBox): BrowserInputEvent | undefined {
  const a = toPagePoint(from.clientX, from.clientY, box)
  const b = toPagePoint(to.clientX, to.clientY, box)
  if (!a || !b) return undefined
  const round = (n: number) => Math.round(n * 100) / 100
  return { type: 'wheel', x: b.x, y: b.y, delta_x: round(a.x - b.x), delta_y: round(a.y - b.y) }
}

/** Keeps the newest of consecutive moves (and sums consecutive wheels at one point), so a batch stays small. */
export function coalesce(events: BrowserInputEvent[]): BrowserInputEvent[] {
  const out: BrowserInputEvent[] = []
  for (const e of events) {
    const prev = out.at(-1)
    if (prev?.type === 'mouse' && prev.action === 'move' && e.type === 'mouse' && e.action === 'move') out[out.length - 1] = e
    else if (prev?.type === 'wheel' && e.type === 'wheel' && prev.x === e.x && prev.y === e.y) out[out.length - 1] = { ...e, delta_x: prev.delta_x + e.delta_x, delta_y: prev.delta_y + e.delta_y }
    else if (prev?.type === 'resize' && e.type === 'resize') out[out.length - 1] = e
    else out.push(e)
  }
  return out
}

export type BrowserControl =
  | { status: 'off'; ended?: ControlEndReason; error?: string }
  | { status: 'taking' }
  | { status: 'on'; controlId: string }
  /** Another tab of the same user has control. */
  | { status: 'held' }

/** Least time between two input requests. */
export const INPUT_FLUSH_MS = 50
const MAX_BATCH = 50

/**
 * Control of `sessionId`'s browser. `serverControl` is the live stream's newest `control` event, so an
 * idle timeout or another tab's take ends control here too.
 */
export function useBrowserControl(sessionId: string | null, serverControl: { controlled: boolean; reason?: ControlEndReason } | undefined) {
  const [control, setControl] = useState<BrowserControl>({ status: 'off' })
  const grant = useRef<{ sessionId: string; controlId: string } | null>(null)
  const queue = useRef<BrowserInputEvent[]>([])
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  const end = useCallback((ended?: ControlEndReason, error?: string) => {
    grant.current = null
    queue.current = []
    if (timer.current !== undefined) clearTimeout(timer.current)
    timer.current = undefined
    setControl({ status: 'off', ...(ended ? { ended } : {}), ...(error ? { error } : {}) })
  }, [])

  const flush = useCallback(() => {
    timer.current = undefined
    const g = grant.current
    if (!g || queue.current.length === 0) return
    const batch = coalesce(queue.current).slice(0, MAX_BATCH)
    queue.current = []
    api.browserInput(g.sessionId, g.controlId, batch).catch((error: unknown) => {
      if (grant.current !== g) return
      if (error instanceof ApiError && error.status === 409) end('taken')
    })
  }, [end])

  const send = useCallback((event: BrowserInputEvent) => {
    if (!grant.current) return
    queue.current.push(event)
    // Keys and clicks go out at once; moves and wheels wait a little to be merged.
    const urgent = event.type === 'key' || event.type === 'text' || (event.type === 'mouse' && event.action !== 'move')
    if (urgent) {
      if (timer.current !== undefined) clearTimeout(timer.current)
      flush()
    } else timer.current ??= setTimeout(flush, INPUT_FLUSH_MS)
  }, [flush])

  const take = useCallback(async (force = false) => {
    if (sessionId === null) return
    setControl({ status: 'taking' })
    try {
      const g = await api.takeBrowserControl(sessionId, force)
      grant.current = { sessionId, controlId: g.control_id }
      setControl({ status: 'on', controlId: g.control_id })
    } catch (error) {
      if (error instanceof ApiError && error.code === 'browser_control_held') setControl({ status: 'held' })
      else setControl({ status: 'off', error: error instanceof Error ? error.message : 'Could not take control' })
    }
  }, [sessionId])

  const handBack = useCallback(() => {
    const g = grant.current
    if (g) {
      flush()
      void api.releaseBrowserControl(g.sessionId, g.controlId)
    }
    end('released')
  }, [end, flush])

  // The server ended control (idle, another tab, the view closed).
  useEffect(() => {
    if (serverControl && !serverControl.controlled && grant.current) end(serverControl.reason)
  }, [serverControl, end])

  // Leaving the tab or the chat hands control back.
  useEffect(() => {
    const onHide = () => { if (document.visibilityState === 'hidden' && grant.current) handBack() }
    document.addEventListener('visibilitychange', onHide)
    return () => {
      document.removeEventListener('visibilitychange', onHide)
      const g = grant.current
      if (g) void api.releaseBrowserControl(g.sessionId, g.controlId)
      grant.current = null
      if (timer.current !== undefined) clearTimeout(timer.current)
    }
  }, [sessionId, handBack])

  return { control, take, handBack, send }
}
