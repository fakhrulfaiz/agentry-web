'use client'

/**
 * The agent's cursor over the Browser tab's live frame: an arrow that glides to each point the page's
 * mouse events report, a press and ripple on a click, and a short outline on the field the agent types
 * into. It sits over the same box the frame is drawn in, so page pixels are mapped with the take-over's
 * letterbox maths (`toFramePoint`). Hidden before the first event, three seconds after the last one, and
 * while the user has control. A recording's player (`VideoView`) drives it with the video's time (`clock`).
 */
import { colorVars, radiusVars, spacingVars } from '@astryxdesign/core/theme/tokens.stylex'
import * as stylex from '@stylexjs/stylex'
import { useEffect, useRef, useState } from 'react'
import { toFramePoint, type FrameBox } from '@/chat/browser-input'
import type { LiveFocus, LivePointer } from '@/chat/use-browser-live'
import { usePrefersReducedMotion } from '@/ui/chat/use-reduced-motion'
import './browser-cursor.css'

export interface BrowserCursorProps {
  pointer: LivePointer | undefined
  focus: LiveFocus | undefined
  /** The page's size in CSS pixels, as the frame says. */
  page: { width?: number; height?: number } | undefined
  /** The user has control: the agent's cursor is hidden. */
  inControl: boolean
  /**
   * A recording's video time (ms). When given, `pointer.at` and `focus.at` are video times too, and visibility
   * follows the video (shown until `CURSOR_HIDE_MS` / `FOCUS_OUTLINE_MS` after the event) instead of the wall clock.
   */
  clock?: number
}

/** How long the cursor stays after the last event, and how long a focus outline shows. */
export const CURSOR_HIDE_MS = 3000
export const FOCUS_OUTLINE_MS = 1200

const styles = stylex.create({
  layer: {
    position: 'absolute',
    inset: 0,
    overflow: 'hidden',
    pointerEvents: 'none',
  },
  cursor: {
    position: 'absolute',
    insetInlineStart: 0,
    insetBlockStart: 0,
    opacity: 1,
  },
  glide: { transitionProperty: 'transform', transitionDuration: '350ms', transitionTimingFunction: 'ease-out' },
  arrow: {
    display: 'block',
    inlineSize: spacingVars['--spacing-4'],
    blockSize: spacingVars['--spacing-5'],
    color: colorVars['--color-accent'],
    transformOrigin: 'top left',
    transitionProperty: 'transform',
    transitionDuration: '120ms',
  },
  outline: { stroke: colorVars['--color-background-card'] },
  pressed: { transform: 'scale(0.85)' },
  ring: {
    position: 'absolute',
    insetInlineStart: `calc(${spacingVars['--spacing-6']} / -2)`,
    insetBlockStart: `calc(${spacingVars['--spacing-6']} / -2)`,
    inlineSize: spacingVars['--spacing-6'],
    blockSize: spacingVars['--spacing-6'],
    borderRadius: radiusVars['--radius-full'],
    borderWidth: 2,
    borderStyle: 'solid',
    borderColor: colorVars['--color-accent'],
  },
  focus: {
    position: 'absolute',
    borderWidth: 2,
    borderStyle: 'solid',
    borderColor: colorVars['--color-accent'],
    borderRadius: radiusVars['--radius-element'],
  },
})

/** A mouse arrow (tip at the top left) that reads on any page: accent fill, light outline. */
function Arrow({ pressed }: { pressed: boolean }) {
  return (
    <svg viewBox="0 0 12 20" aria-hidden="true" {...stylex.props(styles.arrow, pressed && styles.pressed)}>
      <path d="M1 1 L1 15 L4.6 11.6 L7.2 17.6 L9.4 16.6 L6.8 10.8 L11.4 10.8 Z" fill="currentColor" strokeWidth="1" strokeLinejoin="round" {...stylex.props(styles.outline)} />
    </svg>
  )
}

/** Shown for `ms` after each change of `key`; `false` before the first one. */
function useRecent(key: number | undefined, ms: number): boolean {
  const [shown, setShown] = useState(false)
  useEffect(() => {
    if (key === undefined) { setShown(false); return }
    setShown(true)
    const timer = setTimeout(() => { setShown(false) }, ms)
    return () => { clearTimeout(timer) }
  }, [key, ms])
  return shown
}

export function BrowserCursor({ pointer, focus, page, inControl, clock }: BrowserCursorProps) {
  const layerRef = useRef<HTMLDivElement>(null)
  const reduced = usePrefersReducedMotion()
  const [size, setSize] = useState<{ width: number; height: number }>({ width: 0, height: 0 })
  useEffect(() => {
    const layer = layerRef.current
    if (!layer) return
    const measure = () => {
      const r = layer.getBoundingClientRect()
      setSize((prev) => (prev.width === r.width && prev.height === r.height ? prev : { width: r.width, height: r.height }))
    }
    measure()
    const observer = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(measure)
    observer?.observe(layer)
    return () => { observer?.disconnect() }
  }, [])
  const liveCursor = useRecent(clock === undefined ? pointer?.at : undefined, CURSOR_HIDE_MS)
  const liveFocus = useRecent(clock === undefined ? focus?.at : undefined, FOCUS_OUTLINE_MS)
  const within = (at: number | undefined, ms: number) => clock !== undefined && at !== undefined && clock >= at && clock - at < ms
  const cursorVisible = clock === undefined ? liveCursor : within(pointer?.at, CURSOR_HIDE_MS)
  const focusVisible = clock === undefined ? liveFocus : within(focus?.at, FOCUS_OUTLINE_MS)

  const box: FrameBox = { left: 0, top: 0, width: size.width, height: size.height, pageWidth: page?.width ?? 0, pageHeight: page?.height ?? 0 }
  const at = pointer ? toFramePoint(pointer.x, pointer.y, box) : undefined
  const corner = focus ? toFramePoint(focus.x, focus.y, box) : undefined
  const scale = box.pageWidth > 0 && box.pageHeight > 0 ? Math.min(box.width / box.pageWidth, box.height / box.pageHeight) : 0
  const showCursor = !inControl && cursorVisible && pointer !== undefined && at !== undefined
  const showFocus = !inControl && focusVisible && corner !== undefined && focus !== undefined

  return (
    <div ref={layerRef} data-testid="browser-cursor-layer" aria-hidden="true" {...stylex.props(styles.layer)}>
      {showFocus && (
        <div
          key={focus.at}
          data-testid="browser-cursor-focus"
          data-cursor-focus=""
          {...stylex.props(styles.focus)}
          style={{ left: corner.x, top: corner.y, width: focus.width * scale, height: focus.height * scale }}
        />
      )}
      {showCursor && (
        <div
          data-testid="browser-cursor"
          data-action={pointer.action}
          {...stylex.props(styles.cursor, !reduced && styles.glide)}
          style={{ transform: `translate(${at.x}px, ${at.y}px)` }}
        >
          {pointer.action === 'down' && !reduced && <span key={pointer.at} data-testid="browser-cursor-ring" data-cursor-ring="" {...stylex.props(styles.ring)} />}
          <Arrow pressed={pointer.action === 'down'} />
        </div>
      )}
    </div>
  )
}
