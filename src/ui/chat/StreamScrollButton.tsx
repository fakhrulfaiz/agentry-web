'use client'

/**
 * ChatLayout's scroll-to-bottom pill: shown while the reader is above the newest message,
 * labelled "New messages" when a row arrived during that, and cleared once they are back
 * at the bottom (astryx's own pill keeps that label until it is clicked).
 */
import { ChatLayoutScrollButton, useChatLayoutContext } from '@astryxdesign/core/Chat'
import { useCallback, useEffect, useRef, useState } from 'react'

/** Match astryx's button threshold: a small gap from the bottom is still "at the bottom". */
const BUTTON_THRESHOLD = 100

export function StreamScrollButton(): React.JSX.Element | null {
  const layout = useChatLayoutContext()
  const [scrolledUp, setScrolledUp] = useState(false)
  const [hasNew, setHasNew] = useState(false)
  const atBottom = useRef(true)
  const lastRow = useRef<Element | null>(null)

  useEffect(() => {
    const el = layout?.scrollContainerRef.current
    if (!el) return
    const update = () => {
      const up = el.scrollHeight - el.scrollTop - el.clientHeight > BUTTON_THRESHOLD
      atBottom.current = !up
      setScrolledUp(up)
      if (!up) setHasNew(false)
    }
    update()
    el.addEventListener('scroll', update, { passive: true })
    return () => el.removeEventListener('scroll', update)
  }, [layout])

  // A new chat row (not just more streamed text in the last one) is a "New messages" event.
  useEffect(() => {
    const el = layout?.scrollContainerRef.current
    if (!el) return
    const observer = new MutationObserver(() => {
      const rows = el.getElementsByClassName('astryx-chat-message')
      const row = rows.length > 0 ? rows[rows.length - 1] : null
      if (!row || row === lastRow.current) return
      if (lastRow.current && !atBottom.current) setHasNew(true)
      lastRow.current = row
    })
    observer.observe(el, { childList: true, subtree: true })
    return () => observer.disconnect()
  }, [layout])

  const toBottom = useCallback(() => {
    const el = layout?.scrollContainerRef.current
    if (!el) return
    el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' })
    setHasNew(false)
    setScrolledUp(false)
  }, [layout])

  if (!layout) return null
  return <ChatLayoutScrollButton isVisible={scrolledUp} label={hasNew ? 'New messages' : undefined} onClick={toBottom} />
}
