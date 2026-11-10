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
 * change handlers (a new chat, and an open chat, where the next message
 * carries a change); without them they show the current values, disabled,
 * with `hint` as the reason. `efforts` narrows the effort choices.
 *
 * Attachments: the attach button is present but disabled until Agentry has an
 * upload endpoint; the attachments drawer renders once there are attachments,
 * which is never today.
 *
 * Slash menu: typing `/` at the start of the message opens a menu with up to
 * three groups, in this order: Commands (`dshCommands`, run on the backend
 * through `onRunCommand`, greyed out while a turn runs), App (`appHandlers`,
 * run in the web app) and Skills (`commands`, insert `/name `). Arrows, Enter,
 * Tab and Escape work as in any menu; a row that takes text inserts `/name `
 * and waits, one that does not runs at once. Without any entries there is no
 * menu, and `/x` is sent as text.
 *
 * Submit routing: a line naming a backend command runs it, one naming an app
 * command runs its handler, anything else (skills included) is a message.
 * A refused command (`AppCommandError`) is shown as a notice and the text stays.
 */
import { Button } from '@astryxdesign/core/Button'
import { ChatComposer, ChatComposerDrawer, ChatComposerInput, type ChatComposerTrigger } from '@astryxdesign/core/Chat'
import { HStack } from '@astryxdesign/core/HStack'
import { Icon } from '@astryxdesign/core/Icon'
import { Selector } from '@astryxdesign/core/Selector'
import { Text } from '@astryxdesign/core/Text'
import { Token } from '@astryxdesign/core/Token'
import { useToast } from '@astryxdesign/core/Toast'
import { VStack } from '@astryxdesign/core/VStack'
import { LightBulbIcon, PaperClipIcon } from '@heroicons/react/24/outline'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { AgentCommand, ReasoningEffort } from '@/api/types'
import { APP_COMMANDS, AppCommandError, parseSlashLine, type AppCommandHandlers } from '@/commands/app-commands'
import { focusEditor } from './focus'
import { buildSlashItems, slashSource, type SlashItemData } from './slash-menu'

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
  /** Efforts offered (default: all, Auto first). */
  efforts?: EffortChoice[]
  /** Why the menus without a change handler are disabled. */
  hint?: string
}

function SettingsMenus({ settings }: { settings: ComposerSettings }) {
  const { models, model, onModelChange, effort, onEffortChange, efforts, hint } = settings
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
        options={efforts ? EFFORTS.filter((e) => efforts.includes(e.value)) : EFFORTS}
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
  dshCommands = [],
  appHandlers,
  onRunCommand,
  initialValue = '',
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
  /** Skills for the `/` menu's Skills group (none until Agentry lists them). */
  commands?: SlashCommand[]
  /** Backend commands for the Commands group. */
  dshCommands?: AgentCommand[]
  /** App commands this page can run; others are not offered. */
  appHandlers?: AppCommandHandlers
  /** Runs a backend command (`input` is the text after the name); a rejection keeps the text. */
  onRunCommand?(name: string, input: string): Promise<void>
  /** Text the composer starts with (read once, on mount). */
  initialValue?: string
  status?: { type: 'error' | 'warning'; message?: string }
  autoFocus?: boolean
}) {
  const toast = useToast()
  const [value, setValue] = useState(initialValue)
  const [sending, setSending] = useState(false)
  const root = useRef<HTMLDivElement | null>(null)
  const refocus = useRef(autoFocus)
  // No upload endpoint yet, so this stays empty and the drawer hidden.
  const attachments: string[] = []

  // Focus goes to the editor once it is editable (a new chat's waits for the models), never to a button.
  useEffect(() => {
    if (!sending && !isDisabled && refocus.current && focusEditor(root.current)) refocus.current = false
  }, [sending, isDisabled])

  const submitRef = useRef<(text: string) => Promise<void>>(async () => {})
  const app = useMemo(() => APP_COMMANDS.filter((c) => appHandlers?.[c.name]), [appHandlers])
  const slash = useMemo<ChatComposerTrigger | null>(() => {
    const items = buildSlashItems({ commands: onRunCommand ? dshCommands : [], app, skills: commands, busy: isRunning })
    if (items.length === 0) return null
    return {
      character: '/',
      searchSource: slashSource(items),
      menuLabel: 'Commands',
      emptySearchText: 'No matching command',
      renderItem: (item) => {
        const data = item.auxiliaryData as SlashItemData
        return (
          <HStack gap={2} vAlign="center" hAlign="between" width="100%">
            <VStack>
              <Text type={data.disabled ? 'supporting' : undefined}>/{item.label}</Text>
              {(data.description || data.disabled) && (
                <Text type="supporting">{data.disabled ? 'Available when the turn finishes' : data.description}</Text>
              )}
            </VStack>
            {data.hint && <Text type="supporting">{data.hint}</Text>}
          </HStack>
        )
      },
      onSelect: (item) => {
        const data = item.auxiliaryData as SlashItemData
        // A row that needs no text runs at once; a skill or a row with a hint waits for the rest of the line.
        if (data.group !== 'Skills' && !data.hint && !data.disabled) {
          void submitRef.current(`/${data.name}`)
          return ''
        }
        return `/${data.name} `
      },
    }
  }, [commands, dshCommands, app, onRunCommand, isRunning])
  // Only at the start of the message: a `/` later in the text is just text.
  const triggers = slash && (value === '' || value.startsWith('/')) ? [slash] : undefined

  /** Opens the model or effort menu by clicking its trigger. */
  const openMenu = (menu: 'model' | 'effort'): boolean => {
    const trigger = root.current?.querySelector<HTMLElement>(`[aria-label="${menu === 'model' ? 'Model' : 'Reasoning effort'}"]:not([disabled])`)
    trigger?.click()
    return trigger != null
  }

  /** Routes a slash line to the backend or an app handler. Returns false when the line is a message. */
  async function runSlash(text: string): Promise<boolean> {
    const parsed = parseSlashLine(text)
    if (!parsed) return false
    if (onRunCommand && dshCommands.some((c) => c.name === parsed.name)) {
      if (isRunning) throw new AppCommandError('Wait for the current turn to finish')
      await onRunCommand(parsed.name, parsed.arg)
      return true
    }
    const handler = appHandlers?.[parsed.name as keyof AppCommandHandlers]
    if (!handler || !app.some((c) => c.name === parsed.name)) return false
    const notice = await handler(parsed.arg, { openMenu })
    if (notice) toast({ type: 'info', body: notice })
    return true
  }

  async function submit(text: string) {
    if (sending || isDisabled || !text.trim()) return
    setSending(true)
    try {
      if (!(await runSlash(text))) await onSend(text)
      setValue('')
    } catch (error) {
      if (error instanceof AppCommandError) toast({ type: 'error', body: error.message })
      // Otherwise the caller shows the error; either way the text comes back so it can be sent again.
      setValue(text)
    } finally {
      refocus.current = true
      setSending(false)
    }
  }
  submitRef.current = submit

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
