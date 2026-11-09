'use client'

/**
 * Message composer: multi-line; Enter sends, Shift+Enter adds a line. While a
 * turn runs the send button becomes Stop (typing and Enter still send, which
 * steers the running turn). The input is disabled while a send is in flight,
 * and focus returns to it afterwards.
 */
import { ChatComposer } from '@astryxdesign/core/Chat'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { focusFirstControl } from './focus'

export function Composer({
  onSend,
  onStop,
  isRunning = false,
  isDisabled = false,
  placeholder = 'Message Agentry…',
  footer,
  status,
  autoFocus = false,
}: {
  /** Resolves when the message was accepted; a rejection keeps the text in the composer. */
  onSend(text: string): Promise<void>
  onStop?(): void
  isRunning?: boolean
  isDisabled?: boolean
  placeholder?: string
  footer?: ReactNode
  status?: { type: 'error' | 'warning'; message?: string }
  autoFocus?: boolean
}) {
  const [value, setValue] = useState('')
  const [sending, setSending] = useState(false)
  const root = useRef<HTMLDivElement | null>(null)
  const refocus = useRef(autoFocus)

  useEffect(() => {
    if (!sending && refocus.current) {
      refocus.current = false
      focusFirstControl(root.current)
    }
  }, [sending])

  async function submit(text: string) {
    if (sending || isDisabled || !text.trim()) return
    setSending(true)
    try {
      await onSend(text)
      setValue('')
    } catch {
      // The caller shows the error; the text comes back so it can be sent again.
      setValue(text)
    } finally {
      refocus.current = true
      setSending(false)
    }
  }

  return (
    <ChatComposer
      ref={root}
      value={value}
      onChange={setValue}
      onSubmit={(text) => void submit(text)}
      onStop={onStop}
      isStopShown={isRunning && !sending && !value.trim() && onStop !== undefined}
      isDisabled={isDisabled || sending}
      placeholder={placeholder}
      footerActions={footer}
      status={status}
    />
  )
}
