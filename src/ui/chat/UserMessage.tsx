'use client'

/**
 * The user's message as a right-aligned bubble. Hovering it (or moving focus
 * into it) shows the actions under the bubble, as in claude.ai: Retry (send
 * the same text again), Edit (change the text, then send it) and Copy.
 * The backend keeps one linear history, so an edited message is sent as a new
 * message at the end of the chat; earlier turns stay as they are.
 */
import { Button } from '@astryxdesign/core/Button'
import { ChatMessage, ChatMessageBubble } from '@astryxdesign/core/Chat'
import { HStack } from '@astryxdesign/core/HStack'
import { Icon } from '@astryxdesign/core/Icon'
import { IconButton } from '@astryxdesign/core/IconButton'
import { Text } from '@astryxdesign/core/Text'
import { TextArea } from '@astryxdesign/core/TextArea'
import { VStack } from '@astryxdesign/core/VStack'
import { ArrowPathIcon, CheckIcon, ClipboardDocumentIcon, PencilIcon } from '@heroicons/react/24/outline'
import * as stylex from '@stylexjs/stylex'
import { useEffect, useRef, useState, type FocusEvent, type KeyboardEvent } from 'react'
import type { MessageView } from '@/chat/reducer'
import { MessageFiles } from './MessageFiles'

type UserView = Extract<MessageView, { kind: 'user' }>

const COPIED_MS = 1500

const styles = stylex.create({
  userText: { whiteSpace: 'pre-wrap' },
  // Hidden actions keep their space, so the list does not jump on hover.
  actions: { opacity: 0, transition: 'opacity 120ms ease' },
  shown: { opacity: 1 },
  editor: { width: '100%' },
})

export function UserMessage({
  view,
  anchor,
  highlight,
  onSend,
}: {
  view: UserView
  anchor?: string
  highlight?: stylex.StyleXStyles
  /** Sends a message; absent while a turn runs (Retry and Edit are then hidden). */
  onSend?: (text: string) => void
}) {
  const [hovered, setHovered] = useState(false)
  const [focused, setFocused] = useState(false)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(view.text)
  const [copied, setCopied] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  useEffect(() => () => clearTimeout(timer.current), [])

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(view.text)
      setCopied(true)
      clearTimeout(timer.current)
      timer.current = setTimeout(() => setCopied(false), COPIED_MS)
    } catch {
      // Clipboard refused (insecure context, permission): nothing to show.
    }
  }

  const startEdit = () => {
    setDraft(view.text)
    setEditing(true)
  }
  const send = () => {
    const text = draft.trim()
    if (!text || !onSend) return
    setEditing(false)
    onSend(text)
  }
  const onEditorKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') setEditing(false)
    else if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault()
      send()
    }
  }
  const onBlur = (e: FocusEvent) => {
    if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setFocused(false)
  }

  if (editing) {
    return (
      <ChatMessage sender="user" name="" data-item-id={anchor} xstyle={highlight}>
        <VStack gap={2} xstyle={styles.editor} onKeyDown={onEditorKey}>
          <TextArea label="Edit message" isLabelHidden value={draft} onChange={setDraft} rows={Math.min(8, Math.max(2, draft.split('\n').length))} hasAutoFocus />
          <HStack gap={2} hAlign="end">
            <Button label="Cancel" variant="secondary" size="sm" onClick={() => setEditing(false)} />
            <Button label="Send" variant="primary" size="sm" isDisabled={!draft.trim() || !onSend} onClick={send} />
          </HStack>
        </VStack>
      </ChatMessage>
    )
  }

  const visible = hovered || focused || copied
  const canSend = onSend !== undefined && view.text.length > 0
  return (
    <ChatMessage
      sender="user"
      name=""
      data-item-id={anchor}
      xstyle={highlight}
      onPointerEnter={() => setHovered(true)}
      onPointerLeave={() => setHovered(false)}
      onFocus={() => setFocused(true)}
      onBlur={onBlur}
      metadata={
        <HStack gap={0.5} hAlign="end" xstyle={[styles.actions, visible && styles.shown]} data-testid="user-message-actions">
          {canSend && (
            <IconButton label="Retry" tooltip="Retry" variant="ghost" size="sm" icon={<Icon icon={ArrowPathIcon} size="sm" />} onClick={() => onSend(view.text)} />
          )}
          {canSend && <IconButton label="Edit" tooltip="Edit" variant="ghost" size="sm" icon={<Icon icon={PencilIcon} size="sm" />} onClick={startEdit} />}
          {view.text.length > 0 && (
            <IconButton
              label={copied ? 'Copied' : 'Copy'}
              tooltip={copied ? 'Copied' : 'Copy'}
              variant="ghost"
              size="sm"
              icon={<Icon icon={copied ? CheckIcon : ClipboardDocumentIcon} size="sm" />}
              onClick={() => void copy()}
            />
          )}
        </HStack>
      }
    >
      <ChatMessageBubble>
        <VStack gap={2}>
          {view.files && <MessageFiles files={view.files} />}
          {view.text && <Text xstyle={styles.userText}>{view.text}</Text>}
        </VStack>
      </ChatMessageBubble>
    </ChatMessage>
  )
}
