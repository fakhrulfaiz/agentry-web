'use client'

/**
 * The chat inside the global Ask Agentry drawer. It reuses the live session
 * hook and the same message/composer primitives as a full chat, but never
 * navigates: the first send creates a session and reports its id upward.
 */
import { Banner } from '@astryxdesign/core/Banner'
import { Button } from '@astryxdesign/core/Button'
import { ChatLayout, ChatMessageList } from '@astryxdesign/core/Chat'
import { EmptyState } from '@astryxdesign/core/EmptyState'
import { Icon } from '@astryxdesign/core/Icon'
import { VStack } from '@astryxdesign/core/VStack'
import { SparklesIcon } from '@heroicons/react/24/outline'
import * as stylex from '@stylexjs/stylex'
import { useEffect, useMemo, useState } from 'react'
import { api, ApiError, isSignedOut, SETTING_NOT_LIVE } from '@/api/client'
import type { OAIAgentSession } from '@/api/types'
import type { UserFile } from '@/chat/attachments'
import { browserState } from '@/chat/browser-tools'
import { chooseEffort, chooseModel, type AppCommandHandlers } from '@/commands/app-commands'
import { PanelConversationContext, type PanelConversation } from '@/chat/panel-data'
import { setPendingFirst } from '@/chat/pending-first'
import { splitSubagentActions } from '@/chat/subagent-actions'
import { deriveTasks } from '@/chat/tasks'
import { deriveTodos } from '@/chat/todos'
import { useSkillCommands, useSkillsLoader } from '@/skills/skills-store'
import { waitingLabel } from '@/chat/show-steps'
import { goToLogin, useConversation, type ActionAnswer } from '@/chat/use-conversation'
import { SESSIONS_CHANGED } from '@/ui/shell/session-actions'
import { ErrorBanner, isUnavailable } from '@/ui/errors/ErrorBanner'
import { withSettings, useChatSettings } from './chat-settings'
import { Composer, type EffortChoice } from './Composer'
import { ConnectionPill } from './ConnectionPill'
import { groupTurns } from './group-turns'
import { Message, renderRows } from './Message'
import { TurnGroup } from './TurnGroup'
import { StreamScrollButton } from './StreamScrollButton'
import { SubagentActions, SubagentItems } from './SubagentCard'
import { Thinking } from './Thinking'

const styles = stylex.create({
  panel: { blockSize: '100%', minBlockSize: 0, flexGrow: 1, minInlineSize: 0 },
  chat: { flexGrow: 1, minBlockSize: 0, minInlineSize: 0 },
})

/** The built-in setup assistant's id; every helper chat uses it. */
const AGENTRY_AGENT = 'agentry'

type Failure = { message: string; retry?: () => void; unavailable: boolean }

function messageOf(error: unknown): string {
  return error instanceof ApiError ? error.message : 'Something went wrong. Try again.'
}

export interface AskAgentryPanelProps {
  sessionId: string | null
  onSessionCreated(id: string): void
  /** Returns the drawer to the start state (slash command or a deleted session). */
  onNewChat?(): void
}

export function AskAgentryPanel({ sessionId, onSessionCreated, onNewChat = () => {} }: AskAgentryPanelProps) {
  return sessionId ? <HelperChat sessionId={sessionId} onNewChat={onNewChat} /> : <HelperStart onSessionCreated={onSessionCreated} />
}

/** The first send, before a session exists: create one with the built-in agent and hand it to the drawer. */
function HelperStart({ onSessionCreated }: { onSessionCreated(id: string): void }) {
  const [models, setModels] = useState<string[] | null>(null)
  const [model, setModel] = useState('')
  const [effort, setEffort] = useState<EffortChoice>('auto')
  const [pending, setPending] = useState<string | null>(null)
  const [restore, setRestore] = useState<{ text: string; n: number } | null>(null)
  const [failure, setFailure] = useState<Failure | null>(null)
  const commands = useSkillCommands()

  useEffect(() => {
    let live = true
    api.models().then(
      (list) => {
        if (!live) return
        setModels(list)
        setModel((current) => (current && list.includes(current) ? current : list[0] ?? ''))
        setFailure(null)
      },
      (error: unknown) => {
        if (isSignedOut(error)) return goToLogin()
        if (!live) return
        setModels([])
        setFailure({ message: messageOf(error), unavailable: isUnavailable(error) })
      },
    )
    return () => { live = false }
  }, [])

  async function send(text: string) {
    setPending(text)
    try {
      const session = await api.createSession({ text, model, ...(effort === 'auto' ? {} : { effort }), agentId: AGENTRY_AGENT })
      setPendingFirst(session.id, { text, startLabel: 'Starting Agentry…' })
      window.dispatchEvent(new Event(SESSIONS_CHANGED))
      onSessionCreated(session.id)
    } catch (error) {
      setPending(null)
      setRestore((r) => ({ text, n: (r?.n ?? 0) + 1 }))
      if (isSignedOut(error)) goToLogin()
      else setFailure({ message: messageOf(error), unavailable: isUnavailable(error), retry: () => setFailure(null) })
      throw error
    }
  }

  const appHandlers = useMemo<AppCommandHandlers>(() => ({
    model: (arg, { openMenu }) => {
      if (!arg) return openMenu('model') ? undefined : `Model: ${model}`
      setModel(chooseModel(arg, models))
      return `Model set to ${arg}.`
    },
    effort: (arg, { openMenu }) => {
      if (!arg) return openMenu('effort') ? undefined : `Reasoning effort: ${effort}`
      setEffort(chooseEffort(arg, undefined))
      return `Reasoning effort set to ${arg}.`
    },
  }), [model, models, effort])

  return (
    <VStack xstyle={styles.panel}>
      {failure?.unavailable && <ErrorBanner message={failure.message} onRetry={() => failure.retry?.()} />}
      <ChatLayout
        xstyle={styles.chat}
        density="balanced"
        emptyState={!pending ? (
          <EmptyState
            isCompact
            headingLevel={2}
            icon={<Icon icon={SparklesIcon} />}
            title="What can I help with?"
            description="Ask about your chats, projects or sandboxes. Agentry asks before it changes anything."
          />
        ) : undefined}
        composer={
          <Composer
            key={restore?.n ?? 0}
            autoFocus
            onSend={send}
            isDisabled={!model}
            commands={commands}
            appHandlers={appHandlers}
            initialValue={restore?.text ?? ''}
            placeholder="Ask Agentry anything…"
            status={failure && !failure.unavailable ? { type: 'error', message: failure.message } : undefined}
            settings={{ models, model, onModelChange: setModel, effort, onEffortChange: setEffort }}
          />
        }
      >
        {pending && (
          <ChatMessageList>
            <Message view={{ kind: 'user', id: 'pending', text: pending }} answer={async () => undefined} />
            <Thinking label="Starting Agentry…" />
          </ChatMessageList>
        )}
      </ChatLayout>
    </VStack>
  )
}

/** An existing helper chat: live stream, cards and a composer, all in the drawer. */
function HelperChat({ sessionId, onNewChat }: { sessionId: string; onNewChat(): void }) {
  const { state, loaded, ready, firstSend, connection, closedReason, send, stop, answer } = useConversation(sessionId)
  // Turns the user opened (steps are folded by default, like the full chat's compact mode).
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set())
  const [session, setSession] = useState<OAIAgentSession | null>(null)
  const [models, setModels] = useState<string[] | null>(null)
  const [failure, setFailure] = useState<Failure | null>(null)
  const settings = useChatSettings(session)
  const commands = useSkillCommands(sessionId)
  useSkillsLoader(sessionId)

  useEffect(() => {
    let live = true
    api.getSession(sessionId).then(
      (body) => { if (live) setSession(body) },
      (error: unknown) => {
        if (isSignedOut(error)) return goToLogin()
        if (live) setFailure({ message: messageOf(error), unavailable: isUnavailable(error) })
      },
    )
    api.models().then(
      (list) => { if (live) setModels(list) },
      () => { if (live) setModels([]) },
    )
    return () => { live = false }
  }, [sessionId])

  const modelOptions = useMemo(() => {
    if (models === null) return null
    const stored = session?.agent.model
    return stored && !models.includes(stored) ? [stored, ...models] : models
  }, [models, session?.agent.model])

  async function run(call: () => Promise<void>) {
    try {
      await call()
      setFailure(null)
    } catch (error) {
      if (!isSignedOut(error)) setFailure({ message: messageOf(error), unavailable: isUnavailable(error) })
      throw error
    }
  }

  const { change, revert } = settings
  async function onSend(text: string, files?: UserFile[]) {
    try {
      await run(() => send(text, change, files))
    } catch (error) {
      if (error instanceof ApiError && error.code === SETTING_NOT_LIVE) revert()
      return
    }
    if (change.model || change.effort !== undefined) setSession((current) => (current ? withSettings(current, change) : current))
    revert()
  }

  const appHandlers = useMemo<AppCommandHandlers>(() => ({
    new: (arg) => (arg ? send(arg) : onNewChat()),
    clear: () => onNewChat(),
    model: (arg, { openMenu }) => {
      if (!arg) return openMenu('model') ? undefined : `Model: ${settings.model}`
      settings.setModel(chooseModel(arg, modelOptions))
      return `Model set to ${arg}. It applies from your next message.`
    },
    effort: (arg, { openMenu }) => {
      if (!arg) return openMenu('effort') ? undefined : `Reasoning effort: ${settings.effort}`
      settings.setEffort(chooseEffort(arg, undefined))
      return `Reasoning effort set to ${arg}. It applies from your next message.`
    },
  }), [send, onNewChat, settings, modelOptions])

  const split = useMemo(() => splitSubagentActions(state.items), [state.items])
  const subagentItems = useMemo(
    () => new Map(state.subagents.flatMap(({ subagent, items }) => (items ? [[subagent.id, items] as const] : []))),
    [state.subagents],
  )
  const panelData = useMemo<PanelConversation>(
    () => ({
      tasks: deriveTasks(state.items, state.subagents, split.bySubagent),
      jobs: state.jobs,
      subagentViews: state.items.flatMap((v) => (v.kind === 'subagent' ? [v] : [])),
      todos: deriveTodos(state.items),
      browser: browserState(state.items),
      items: subagentItems,
      actions: split.bySubagent,
      answer: async (id: string, a: ActionAnswer) => answer(id, a),
    }),
    [state.items, state.subagents, state.jobs, split.bySubagent, subagentItems, answer],
  )

  if (closedReason === 'not_found') {
    return (
      <VStack xstyle={styles.panel}>
        <EmptyState
          isCompact
          headingLevel={2}
          title="This chat is no longer available"
          description="It may have been deleted. Start a new one to keep asking Agentry."
          actions={<Button label="New chat" onClick={onNewChat} />}
        />
      </VStack>
    )
  }

  const running = state.status === 'in_progress' || state.status === 'requires_action'
  const streaming = state.items.some((v) => v.kind === 'assistant' && v.streaming)
  const waiting = !loaded || !ready || running

  return (
    <PanelConversationContext.Provider value={panelData}>
      <VStack xstyle={styles.panel}>
        {closedReason === 'forbidden' && <Banner status="warning" title="Live updates are not available for this chat." />}
        {failure?.unavailable && <ErrorBanner message={failure.message} onRetry={() => failure.retry?.()} />}
        <ChatLayout
          xstyle={styles.chat}
          density="balanced"
          scrollButton={<StreamScrollButton />}
          composer={
            <Composer
              autoFocus
              onSend={onSend}
              onStop={() => void run(stop).catch(() => {})}
              isRunning={running}
              commands={commands}
              appHandlers={appHandlers}
              placeholder="Ask Agentry anything…"
              status={failure && !failure.unavailable ? { type: 'error', message: failure.message } : undefined}
              settings={{
                models: modelOptions,
                model: settings.model,
                onModelChange: settings.setModel,
                effort: settings.effort,
                onEffortChange: settings.setEffort,
              }}
            />
          }
        >
          <SubagentItems.Provider value={subagentItems}>
            <SubagentActions.Provider value={split.bySubagent}>
              <ChatMessageList isStreaming={streaming}>
                {groupTurns(split.items, state.turnOf, state.turns, { live: true, waitingSubagents: new Set(split.bySubagent.keys()) }).map((entry) => {
                  const row = (view: (typeof split.items)[number]) => <Message key={view.id} view={view} answer={answer} />
                  if (entry.type === 'view') return row(entry.view)
                  return (
                    <TurnGroup
                      key={`group-${entry.turnId}`}
                      group={entry}
                      open={expanded.has(entry.turnId)}
                      onOpenChange={(open) =>
                        setExpanded((cur) => {
                          const next = new Set(cur)
                          if (open) next.add(entry.turnId)
                          else next.delete(entry.turnId)
                          return next
                        })
                      }
                    >
                      {renderRows(entry.views, row)}
                    </TurnGroup>
                  )
                })}
                {waiting && <Thinking label={waitingLabel(!loaded || !ready, state.status, firstSend, ready)} />}
              </ChatMessageList>
            </SubagentActions.Provider>
          </SubagentItems.Provider>
        </ChatLayout>
        <ConnectionPill connection={connection} />
      </VStack>
    </PanelConversationContext.Provider>
  )
}
