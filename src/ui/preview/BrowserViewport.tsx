'use client'

/**
 * The Browser tab's fixed viewport. Live Chromium frames and the latest tool screenshot both fill the
 * same 16:10 surface, so the page never moves or resizes when a URL, title or frame changes. While the
 * user has control, pointer, wheel and key events go to that same page in its own pixels.
 */
import { Center } from '@astryxdesign/core/Center'
import { Text } from '@astryxdesign/core/Text'
import { VStack } from '@astryxdesign/core/VStack'
import { colorVars, radiusVars, spacingVars } from '@astryxdesign/core/theme/tokens.stylex'
import * as stylex from '@stylexjs/stylex'
import { useEffect, useRef, type KeyboardEvent, type PointerEvent } from 'react'
import { composedTextEvent, keyEvent, mouseEvent, wheelFromTouch, type BrowserInputEvent, type FrameBox } from '@/chat/browser-input'
import type { LiveFocus, LiveFrame, LivePointer } from '@/chat/use-browser-live'
import { BrowserCursor } from './BrowserCursor'

export interface BrowserViewportProps {
  frame: LiveFrame | null
  screenshotUrl: string | null
  inControl: boolean
  send: (event: BrowserInputEvent) => void
  /** The agent's pointer and focused field from the live stream; drawn over the live frame only. */
  pointer?: LivePointer | undefined
  focus?: LiveFocus | undefined
}

/** Smallest and largest page width sent with a resize (the API's limits). */
const PAGE_WIDTH = { min: 320, max: 1920 }

const styles = stylex.create({
  fill: { flexGrow: 1, minBlockSize: 0 },
  viewport: {
    position: 'relative',
    // Fills what the panel (or the expanded view) leaves: its size never depends on the frame.
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: 0,
    minBlockSize: `calc(${spacingVars['--spacing-12']} * 4)`,
    inlineSize: '100%',
    overflow: 'hidden',
    backgroundColor: colorVars['--color-background-muted'],
    borderWidth: 1,
    borderStyle: 'solid',
    borderColor: colorVars['--color-border'],
    borderRadius: radiusVars['--radius-container'],
  },
  frame: {
    position: 'absolute',
    inset: 0,
    display: 'block',
    inlineSize: '100%',
    blockSize: '100%',
    objectFit: 'contain',
  },
  controlled: {
    cursor: 'default',
    touchAction: 'none',
    userSelect: 'none',
    outlineStyle: { default: 'none', ':focus': 'solid' },
    outlineWidth: 2,
    outlineOffset: 2,
    outlineColor: colorVars['--color-accent'],
  },
})

function frameBox(img: HTMLImageElement, frame: LiveFrame | null): FrameBox {
  const r = img.getBoundingClientRect()
  return {
    left: r.left,
    top: r.top,
    width: r.width,
    height: r.height,
    pageWidth: frame?.width || img.naturalWidth,
    pageHeight: frame?.height || img.naturalHeight,
  }
}

/** The live frame, contained in a constant-ratio surface. */
export function BrowserViewport({ frame, screenshotUrl, inControl, send, pointer: agentPointer, focus: agentFocus }: BrowserViewportProps) {
  const ref = useRef<HTMLImageElement>(null)
  const viewportRef = useRef<HTMLDivElement>(null)
  // A new SSE frame arrives often; the control effect must not re-run (and re-focus the image) for it.
  const frameRef = useRef(frame)
  frameRef.current = frame
  // IME composition and the last point of a one-finger drag are transient input state, not render state.
  const composing = useRef(false)
  const touchFrom = useRef<{ clientX: number; clientY: number } | null>(null)
  // A drag must end without a click even though its last point equals the pointer-up point.
  const touchMoved = useRef(false)
  const src = frame?.src ?? screenshotUrl
  useEffect(() => {
    const img = ref.current
    if (!inControl || !img || !frameRef.current) return
    let lastWidth = 0
    img.focus()
    // The wheel needs a non-passive listener so the panel does not scroll too.
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      const box = frameBox(img, frameRef.current)
      const scale = box.pageWidth > 0 && box.width > 0 ? box.pageWidth / box.width : 1
      const m = mouseEvent({ clientX: e.clientX, clientY: e.clientY, button: 0, buttons: 0, detail: 0, altKey: e.altKey, ctrlKey: e.ctrlKey, metaKey: e.metaKey, shiftKey: e.shiftKey }, 'move', box)
      if (m?.type === 'mouse') send({ type: 'wheel', x: m.x, y: m.y, delta_x: e.deltaX * scale, delta_y: e.deltaY * scale, ...(m.modifiers ? { modifiers: m.modifiers } : {}) })
    }
    img.addEventListener('wheel', onWheel, { passive: false })
    // Losing focus mid-composition must not swallow the next typed key.
    const onBlur = () => { composing.current = false; touchFrom.current = null; touchMoved.current = false }
    img.addEventListener('blur', onBlur)
    // The viewport's own ratio, not the screenshot's, decides the page size while in control.
    const fit = () => {
      const r = viewportRef.current?.getBoundingClientRect()
      if (!r || r.width <= 0 || r.height <= 0) return
      const width = Math.round(Math.min(PAGE_WIDTH.max, Math.max(PAGE_WIDTH.min, r.width)))
      if (Math.abs(width - lastWidth) < 8) return
      lastWidth = width
      send({ type: 'resize', width, height: Math.round(width * r.height / r.width) })
    }
    fit()
    const observer = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(fit)
    if (viewportRef.current) observer?.observe(viewportRef.current)
    return () => {
      img.removeEventListener('wheel', onWheel)
      img.removeEventListener('blur', onBlur)
      composing.current = false
      touchFrom.current = null
      touchMoved.current = false
      observer?.disconnect()
    }
  }, [inControl, send])

  const pointer = (action: 'move' | 'down' | 'up') => (e: PointerEvent<HTMLImageElement>) => {
    if (!inControl || !ref.current) return
    if (action === 'down') {
      e.preventDefault()
      ref.current.focus()
      ref.current.setPointerCapture?.(e.pointerId)
    }
    const box = frameBox(ref.current, frame)
    if (e.pointerType === 'touch') {
      if (action === 'down') {
        touchFrom.current = { clientX: e.clientX, clientY: e.clientY }
        touchMoved.current = false
        const down = mouseEvent(e, 'down', box)
        if (down) send(down)
        return
      }
      const from = touchFrom.current
      if (action === 'move') {
        if (!from) return
        const wheel = wheelFromTouch(from, e, box)
        if (wheel) {
          send(wheel)
          touchMoved.current = true
        }
        touchFrom.current = { clientX: e.clientX, clientY: e.clientY }
        return
      }
      touchFrom.current = null
      const up = mouseEvent(e, 'up', box)
      if (!up || up.type !== 'mouse') return
      const dragged = touchMoved.current
      touchMoved.current = false
      send(dragged ? { ...up, click_count: 0 } : up)
      return
    }
    const m = mouseEvent(e, action, box)
    if (m) send(m)
  }
  const key = (action: 'down' | 'up') => (e: KeyboardEvent<HTMLImageElement>) => {
    if (!inControl) return
    // Esc is never sent: it leaves the frame, so keyboard users are not trapped.
    if (e.key === 'Escape') {
      if (action === 'down') ref.current?.blur()
      return
    }
    e.preventDefault()
    send(keyEvent(e, action, composing.current))
  }

  return (
    <VStack ref={viewportRef} data-testid="browser-viewport" xstyle={styles.viewport}>
      {src ? (
          // eslint-disable-next-line @next/next/no-img-element -- streamed frames / BFF bytes; next/image does not apply
          <img
            ref={ref}
            src={src}
            alt={!frame ? 'Latest screenshot of the agent\'s browser' : inControl ? 'The agent\'s browser. You have control: click, scroll and type here. Esc leaves.' : 'Live view of the agent\'s browser'}
            draggable={false}
            {...(inControl ? {
              tabIndex: 0,
              role: 'application',
              'aria-roledescription': 'remote browser',
              onPointerDown: pointer('down'),
              onPointerMove: pointer('move'),
              onPointerUp: pointer('up'),
              onPointerCancel: () => { touchFrom.current = null; touchMoved.current = false },
              onContextMenu: (e: { preventDefault: () => void }) => { e.preventDefault() },
              onCompositionStart: () => { composing.current = true },
              onCompositionUpdate: () => { composing.current = true },
              onCompositionEnd: (e: { data: string }) => {
                composing.current = false
                const text = composedTextEvent(e.data)
                if (text) send(text)
              },
              onKeyDown: key('down'),
              onKeyUp: key('up'),
              onPaste: (e: { preventDefault: () => void; clipboardData: DataTransfer }) => {
                const text = e.clipboardData.getData('text')
                e.preventDefault()
                if (text) send({ type: 'text', text: text.slice(0, 2000) })
              },
            } : {})}
            {...stylex.props(styles.frame, inControl && styles.controlled)}
            data-testid="browser-frame"
            data-fit="contain"
          />
      ) : (
        <Center padding={0} xstyle={styles.fill}>
          <Text type="supporting" color="secondary">No screenshot yet. The agent mostly reads pages as text; it takes a screenshot when the layout matters or you ask for one.</Text>
        </Center>
      )}
      {frame && <BrowserCursor pointer={agentPointer} focus={agentFocus} page={frame} inControl={inControl} />}
    </VStack>
  )
}
