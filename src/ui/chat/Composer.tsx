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
 * Attachments: the paperclip opens a file picker; files can also be dropped on
 * the composer or pasted (images). Each is staged at once (`useAttachments`)
 * and shown as a card above the input; Send is disabled while an upload is in
 * flight, and a failed upload must be removed first. Limits (25 MB, 10 files)
 * are checked before uploading. `onSend` receives the staged files as its
 * second argument, only when there are any.
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
import { ChatComposer, ChatComposerDrawer, ChatComposerInput, ChatSendButton, type ChatComposerTrigger } from '@astryxdesign/core/Chat'
import { HStack } from '@astryxdesign/core/HStack'
import { Icon } from '@astryxdesign/core/Icon'
import { Selector } from '@astryxdesign/core/Selector'
import { Text } from '@astryxdesign/core/Text'
import { useToast } from '@astryxdesign/core/Toast'
import { VStack } from '@astryxdesign/core/VStack'
import { LightBulbIcon, PaperClipIcon, ServerStackIcon, UserGroupIcon } from '@heroicons/react/24/outline'
import { useEffect, useMemo, useRef, useState, type DragEvent } from 'react'
import type { AgentCommand, ReasoningEffort } from '@/api/types'
import { APP_COMMANDS, AppCommandError, parseSlashLine, type AppCommandHandlers } from '@/commands/app-commands'
import type { UserFile } from '@/chat/attachments'
import { AttachmentCards, useAttachments } from './ComposerAttachments'
import { focusEditor } from './focus'
import { buildSlashItems, SKILL_GROUPS, slashSource, type SlashItemData } from './slash-menu'

/** Efforts offered; `auto` sends none (the agent's default). */
export type EffortChoice = 'auto' | Extract<ReasoningEffort, 'low' | 'medium' | 'high'>
const EFFORTS: { value: EffortChoice; label: string }[] = [
  { value: 'auto', label: 'Auto' },
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' },
]

export interface SlashCommand {
  name: string
  description?: string
  /** For skills: which `/` group it shows in (Built-in, Library, This agent). */
  kind?: 'builtin' | 'library' | 'private' | 'bundled'
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
  /** Saved agents for the agent menu (new chats only); the menu is hidden without any. */
  agents?: { id: string; name: string }[]
  /** The chosen saved agent's id; `''` is the default agent. */
  agentId?: string
  onAgentChange?(id: string): void
  /** Ready sandbox environments for the environment menu (new chats only); hidden without any. */
  environments?: { id: string; name: string; group?: 'new'; description?: string }[]
  /** The chosen environment's id; `''` is the default workspace. */
  environmentId?: string
  onEnvironmentChange?(id: string): void
}

/** Left of the footer: who runs the chat and where (new chats only). Renders nothing without any choice. */
function ContextMenus({ settings }: { settings: ComposerSettings }) {
  const { agents, agentId = '', onAgentChange, environments, environmentId = '', onEnvironmentChange } = settings
  return (
    <>
      {agents && agents.length > 0 && onAgentChange && (
        <Selector
          label="Agent"
          isLabelHidden
          size="sm"
          variant="ghost"
          startIcon={UserGroupIcon}
          options={[{ value: '', label: 'Default agent' }, ...agents.map((a) => ({ value: a.id, label: a.name || 'Untitled agent' }))]}
          value={agentId}
          onChange={onAgentChange}
        />
      )}
      {environments && environments.length > 0 && onEnvironmentChange && (
        <Selector
          label="Environment"
          isLabelHidden
          size="sm"
          variant="ghost"
          startIcon={ServerStackIcon}
          options={environmentOptions(environments)}
          value={environmentId}
          onChange={onEnvironmentChange}
        />
      )}
    </>
  )
}

/** The environment menu: the default workspace, existing environments, then fresh sandboxes for this chat. */
function environmentOptions(environments: NonNullable<ComposerSettings['environments']>) {
  const option = (e: (typeof environments)[number]) => ({ value: e.id, label: e.name, ...(e.description ? { description: e.description } : {}) })
  const existing = environments.filter((e) => e.group !== 'new')
  const fresh = environments.filter((e) => e.group === 'new')
  return [
    { value: '', label: 'Default workspace' },
    ...(existing.length > 0 ? [{ type: 'section' as const, title: 'Your environments', options: existing.map(option) }] : []),
    ...(fresh.length > 0 ? [{ type: 'section' as const, title: 'New sandbox for this chat', options: fresh.map(option) }] : []),
  ]
}

/** Right of the footer, beside the send button: the model and its reasoning effort. */
function ModelMenus({ settings }: { settings: ComposerSettings }) {
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
  density = 'balanced',
}: {
  /** Resolves when the message was accepted; a rejection keeps the text in the composer. */
  onSend(text: string, files?: UserFile[]): Promise<void>
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
  /** `spacious` makes the input taller (the new-chat page). */
  density?: 'balanced' | 'spacious'
}) {
  const toast = useToast()
  const [value, setValue] = useState(initialValue)
  const [sending, setSending] = useState(false)
  const root = useRef<HTMLDivElement | null>(null)
  const refocus = useRef(autoFocus)
  const attachments = useAttachments()
  const picker = useRef<HTMLInputElement | null>(null)
  const [dragging, setDragging] = useState(false)

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
        if (!SKILL_GROUPS.has(data.group) && !data.hint && !data.disabled) {
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
    if (attachments.uploading || attachments.failed) {
      // ChatComposer clears the text after `onSubmit` returns; put it back once it has.
      await Promise.resolve()
      setValue(text)
      return
    }
    setSending(true)
    try {
      const files = attachments.files()
      if (!(await runSlash(text))) await (files.length > 0 ? onSend(text, files) : onSend(text))
      attachments.clear()
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

  const stopShown = isRunning && !sending && !value.trim() && onStop !== undefined
  const hasFiles = (event: DragEvent<HTMLElement>) => Array.from(event.dataTransfer.types).includes('Files')

  return (
    <div
      onDragOver={(event) => {
        if (!hasFiles(event)) return
        event.preventDefault()
        setDragging(true)
      }}
      onDragLeave={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragging(false)
      }}
      onDrop={(event) => {
        if (!hasFiles(event)) return
        event.preventDefault()
        setDragging(false)
        attachments.add(Array.from(event.dataTransfer.files))
      }}
      onPaste={(event) => {
        const files = Array.from(event.clipboardData.files)
        if (files.length === 0) return
        event.preventDefault()
        attachments.add(files)
      }}
      data-dragging={dragging || undefined}
      data-tall={density === 'spacious' || undefined}
      style={dragging ? { outline: '2px dashed var(--color-accent)', outlineOffset: 2, borderRadius: 16 } : undefined}
    >
    <input
      ref={picker}
      type="file"
      multiple
      hidden
      data-testid="attach-input"
      onChange={(event) => {
        attachments.add(Array.from(event.target.files ?? []))
        event.target.value = ''
      }}
    />
    <ChatComposer
      ref={root}
      value={value}
      onChange={setValue}
      onSubmit={(text) => void submit(text)}
      onStop={onStop}
      isStopShown={stopShown}
      isDisabled={isDisabled || sending}
      placeholder={placeholder}
      density={density}
      input={<ChatComposerInput triggers={triggers} maxRows={density === 'spacious' ? 14 : undefined} />}
      drawer={
        attachments.items.length > 0 ? (
          <ChatComposerDrawer>
            <AttachmentCards attachments={attachments} />
          </ChatComposerDrawer>
        ) : undefined
      }
      sendButton={<ChatSendButton isDisabled={attachments.uploading && !stopShown ? true : undefined} />}
      footerActions={
        <>
          <Button label="Attach files" variant="ghost" size="sm" icon={<Icon icon={PaperClipIcon} />} isIconOnly onClick={() => picker.current?.click()} />
          {settings && <ContextMenus settings={settings} />}
        </>
      }
      sendActions={settings ? <ModelMenus settings={settings} /> : undefined}
      status={attachments.error ? { type: 'error', message: attachments.error } : attachments.failed ? { type: 'error', message: 'Remove the failed upload to send.' } : status}
    />
    </div>
  )
}
