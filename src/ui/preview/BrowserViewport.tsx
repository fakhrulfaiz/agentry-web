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
import { useEffect, useRef, type ClipboardEvent, type CompositionEvent, type KeyboardEvent, type PointerEvent } from 'react'
import { composedTextEvent, isComposingKey, keyEvent, mouseEvent, wheelFromTouch, type BrowserInputEvent, type FrameBox } from '@/chat/browser-input'
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
/** Finger jitter below this is still a tap; above it the touch drags the page. */
const TOUCH_SLOP = 8

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
    outlineStyle: { default: 'none', ':focus-within': 'solid' },
    outlineWidth: 2,
    outlineOffset: 2,
    outlineColor: colorVars['--color-accent'],
  },
  // Real IMEs only compose on an editable, focused element. Keep one in the DOM without showing it.
  inputAnchor: {
    position: 'absolute',
    inlineSize: 1,
    blockSize: 1,
    padding: 0,
    borderWidth: 0,
    overflow: 'hidden',
    clipPath: 'inset(50%)',
    whiteSpace: 'nowrap',
    opacity: 0,
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
  const inputRef = useRef<HTMLTextAreaElement>(null)
  // A new SSE frame arrives often; the control effect must not re-run (and re-focus the input) for it.
  const frameRef = useRef(frame)
  frameRef.current = frame
  // IME composition and the transient points of a one-finger drag are input state, not render state.
  const composing = useRef(false)
  const touchOrigin = useRef<{ clientX: number; clientY: number } | null>(null)
  // The last point a wheel was sent from; the origin is kept separately so a jittery tap still clicks.
  const touchFrom = useRef<{ clientX: number; clientY: number } | null>(null)
  const touchMoved = useRef(false)
  const src = frame?.src ?? screenshotUrl
  useEffect(() => {
    const img = ref.current
    const input = inputRef.current
    if (!inControl || !img || !input || !frameRef.current) return
    let lastWidth = 0
    input.focus()
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
    const onBlur = () => {
      composing.current = false
      touchOrigin.current = null
      touchFrom.current = null
      touchMoved.current = false
    }
    input.addEventListener('blur', onBlur)
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
      input.removeEventListener('blur', onBlur)
      composing.current = false
      touchOrigin.current = null
      touchFrom.current = null
      touchMoved.current = false
      observer?.disconnect()
    }
  }, [inControl, send])

  const pointer = (action: 'move' | 'down' | 'up') => (e: PointerEvent<HTMLImageElement>) => {
    if (!inControl || !ref.current) return
    if (action === 'down') {
      e.preventDefault()
      inputRef.current?.focus()
      ref.current.setPointerCapture?.(e.pointerId)
    }
    const box = frameBox(ref.current, frame)
    if (e.pointerType === 'touch') {
      if (action === 'down') {
        touchOrigin.current = { clientX: e.clientX, clientY: e.clientY }
        touchFrom.current = { clientX: e.clientX, clientY: e.clientY }
        touchMoved.current = false
        return
      }
      const origin = touchOrigin.current
      if (!origin) return
      if (action === 'move') {
        if (!touchMoved.current && Math.hypot(e.clientX - origin.clientX, e.clientY - origin.clientY) <= TOUCH_SLOP) return
        const wheel = wheelFromTouch(touchFrom.current ?? origin, e, box)
        if (wheel) {
          send(wheel)
          touchMoved.current = true
        }
        touchFrom.current = { clientX: e.clientX, clientY: e.clientY }
        return
      }
      touchOrigin.current = null
      touchFrom.current = null
      if (touchMoved.current) {
        // A drag sends no mouse press or release: the backend would turn a down/up pair into a click.
        touchMoved.current = false
        return
      }
      touchMoved.current = false
      const at = {
        clientX: origin.clientX, clientY: origin.clientY, button: e.button, buttons: e.buttons, detail: e.detail,
        altKey: e.altKey, ctrlKey: e.ctrlKey, metaKey: e.metaKey, shiftKey: e.shiftKey,
      }
      const down = mouseEvent(at, 'down', box)
      const up = mouseEvent(e, 'up', box)
      if (down) send(down)
      if (up) send(up)
      return
    }
    const m = mouseEvent(e, action, box)
    if (m) send(m)
  }
  const key = (action: 'down' | 'up') => (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (!inControl) return
    // Esc is never sent: it leaves the frame, so keyboard users are not trapped.
    if (e.key === 'Escape') {
      if (action === 'down') e.currentTarget.blur()
      return
    }
    const composingKey = isComposingKey({ isComposing: e.nativeEvent.isComposing, keyCode: e.nativeEvent.keyCode })
    const composingNow = composing.current || composingKey
    // Let the browser run its IME: cancelling a composing keydown can stop composition altogether.
    if (!composingNow) e.preventDefault()
    send(keyEvent(e, action, composingNow))
  }

  return (
    <VStack ref={viewportRef} data-testid="browser-viewport" xstyle={styles.viewport}>
      {src ? (
        <>
          {inControl && (
            <textarea
              ref={inputRef}
              data-testid="browser-input"
              aria-label="Type into the agent's browser"
              autoComplete="off"
              spellCheck={false}
              {...stylex.props(styles.inputAnchor)}
              onCompositionStart={() => { composing.current = true }}
              onCompositionUpdate={() => { composing.current = true }}
              onCompositionEnd={(e: CompositionEvent<HTMLTextAreaElement>) => {
                composing.current = false
                e.currentTarget.value = ''
                const text = composedTextEvent(e.data)
                if (text) send(text)
              }}
              onKeyDown={key('down')}
              onKeyUp={key('up')}
              onPaste={(e: ClipboardEvent<HTMLTextAreaElement>) => {
                const text = e.clipboardData.getData('text')
                e.preventDefault()
                if (text) send({ type: 'text', text: text.slice(0, 2000) })
              }}
            />
          )}
          {/* eslint-disable-next-line @next/next/no-img-element -- streamed frames / BFF bytes; next/image does not apply */}
          <img
            ref={ref}
            src={src}
            alt={!frame ? 'Latest screenshot of the agent\'s browser' : inControl ? 'The agent\'s browser. You have control: click, scroll and type here. Esc leaves.' : 'Live view of the agent\'s browser'}
            draggable={false}
            {...(inControl ? {
              onPointerDown: pointer('down'),
              onPointerMove: pointer('move'),
              onPointerUp: pointer('up'),
              onPointerCancel: () => { touchOrigin.current = null; touchFrom.current = null; touchMoved.current = false },
              onContextMenu: (e: { preventDefault: () => void }) => { e.preventDefault() },
            } : {})}
            {...stylex.props(styles.frame, inControl && styles.controlled)}
            data-testid="browser-frame"
            data-fit="contain"
          />
        </>
      ) : (
        <Center padding={0} xstyle={styles.fill}>
          <Text type="supporting" color="secondary">No screenshot yet. The agent mostly reads pages as text; it takes a screenshot when the layout matters or you ask for one.</Text>
        </Center>
      )}
      {frame && <BrowserCursor pointer={agentPointer} focus={agentFocus} page={frame} inControl={inControl} />}
    </VStack>
  )
}
