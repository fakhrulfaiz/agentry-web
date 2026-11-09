'use client'

/**
 * Message composer, from astryx's full-featured `ChatComposer` template:
 * input (with the slash-command menu), then a footer row with attach, the
 * model and reasoning-effort menus, and send / stop.
 *
 * Multi-line; Enter sends, Shift+Enter adds a line. While a turn runs the send
 * button becomes Stop (typing and Enter still send, which steers the running
 * turn). The input is disabled while a send is in flight, and focus returns to
 * it afterwards.
 *
 * Settings: the model and effort menus are live when the caller passes their
 * change handlers (a new chat); without them they show the current values,
 * disabled, with `settingsHint` as the reason (an open chat).
 *
 * Attachments: the attach button is present but disabled until Agentry has an
 * upload endpoint; the attachments drawer renders once there are attachments,
 * which is never today.
 *
 * Slash commands: with `commands`, typing `/` at the start of the message
 * opens a menu of them (arrows, Enter, Escape); choosing one inserts
 * `/name `. Without commands there is no menu, and `/x` is sent as text.
 */
import { Button } from '@astryxdesign/core/Button'
import { ChatComposer, ChatComposerDrawer, ChatComposerInput, type ChatComposerTrigger } from '@astryxdesign/core/Chat'
import { Icon } from '@astryxdesign/core/Icon'
import { Selector } from '@astryxdesign/core/Selector'
import { Text } from '@astryxdesign/core/Text'
import { Token } from '@astryxdesign/core/Token'
import { createStaticSource } from '@astryxdesign/core/Typeahead'
import { VStack } from '@astryxdesign/core/VStack'
import { LightBulbIcon, PaperClipIcon } from '@heroicons/react/24/outline'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { ReasoningEffort } from '@/api/types'
import { focusEditor } from './focus'

/** Efforts offered; `auto` sends none (the agent's default). */
export type EffortChoice = 'auto' | Extract<ReasoningEffort, 'low' | 'medium' | 'high'>
const EFFORTS: { value: EffortChoice; label: string }[] = [
  { value: 'auto', label: 'Auto' },
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' },
]

export const ATTACH_HINT = 'File attachments need backend support'

export interface SlashCommand {
  name: string
  description?: string
}

export interface ComposerSettings {
  /** Offered models; `null` while loading. */
  models: string[] | null
  model: string
  /** Absent: the menu is disabled with `hint`. */
  onModelChange?(model: string): void
  effort: EffortChoice
  onEffortChange?(effort: EffortChoice): void
  /** Why the menus without a change handler are disabled. */
  hint?: string
}

function SettingsMenus({ settings }: { settings: ComposerSettings }) {
  const { models, model, onModelChange, effort, onEffortChange, hint } = settings
  // A disabled menu still names its current value.
  const modelOptions = models && models.length > 0 ? models : model ? [model] : []
  return (
    <>
      <Selector
        label="Model"
        isLabelHidden
        size="sm"
        variant="ghost"
        options={modelOptions}
        value={model}
        onChange={(value) => onModelChange?.(value)}
        isLoading={models === null && onModelChange !== undefined}
        isDisabled={!onModelChange}
        disabledMessage={onModelChange ? undefined : hint}
        placeholder="Model"
      />
      <Selector
        label="Reasoning effort"
        isLabelHidden
        size="sm"
        variant="ghost"
        startIcon={LightBulbIcon}
        options={EFFORTS}
        value={effort}
        onChange={(value) => onEffortChange?.(value as EffortChoice)}
        isDisabled={!onEffortChange}
        disabledMessage={onEffortChange ? undefined : hint}
      />
    </>
  )
}

export function Composer({
  onSend,
  onStop,
  isRunning = false,
  isDisabled = false,
  placeholder = 'Message Agentry…',
  settings,
  commands = [],
  status,
  autoFocus = false,
}: {
  /** Resolves when the message was accepted; a rejection keeps the text in the composer. */
  onSend(text: string): Promise<void>
  onStop?(): void
  isRunning?: boolean
  isDisabled?: boolean
  placeholder?: string
  settings?: ComposerSettings
  /** Slash commands for the `/` menu (none until Agentry lists skills). */
  commands?: SlashCommand[]
  status?: { type: 'error' | 'warning'; message?: string }
  autoFocus?: boolean
}) {
  const [value, setValue] = useState('')
  const [sending, setSending] = useState(false)
  const root = useRef<HTMLDivElement | null>(null)
  const refocus = useRef(autoFocus)
  // No upload endpoint yet, so this stays empty and the drawer hidden.
  const attachments: string[] = []

  // Focus goes to the editor once it is editable (a new chat's waits for the models), never to a button.
  useEffect(() => {
    if (!sending && !isDisabled && refocus.current && focusEditor(root.current)) refocus.current = false
  }, [sending, isDisabled])

  const slash = useMemo<ChatComposerTrigger | null>(() => {
    if (commands.length === 0) return null
    const items = commands.map((c) => ({ id: c.name, label: c.name, ...(c.description ? { auxiliaryData: c.description } : {}) }))
    return {
      character: '/',
      searchSource: createStaticSource(items),
      menuLabel: 'Commands',
      emptySearchText: 'No matching command',
      renderItem: (item) => (
        <VStack>
          <Text>/{item.label}</Text>
          {typeof item.auxiliaryData === 'string' && <Text type="supporting">{item.auxiliaryData}</Text>}
        </VStack>
      ),
      onSelect: (item) => `/${item.id} `,
    }
  }, [commands])
  // Only at the start of the message: a `/` later in the text is just text.
  const triggers = slash && (value === '' || value.startsWith('/')) ? [slash] : undefined

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
      input={<ChatComposerInput triggers={triggers} />}
      drawer={
        attachments.length > 0 ? (
          <ChatComposerDrawer count={attachments.length} label="Files">
            {attachments.map((name) => (
              <Token key={name} label={name} />
            ))}
          </ChatComposerDrawer>
        ) : undefined
      }
      footerActions={
        <>
          <Button label="Attach files" variant="ghost" size="sm" icon={<Icon icon={PaperClipIcon} />} isIconOnly isDisabled tooltip={ATTACH_HINT} />
          {settings && <SettingsMenus settings={settings} />}
        </>
      }
      status={status}
    />
  )
}
