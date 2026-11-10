'use client'

/**
 * One open conversation: history plus the live stream (`useConversation`),
 * rendered as chat rows, with the composer pinned below. Errors: a 401 goes to
 * `/login` (the hook and client do this); a 503 shows the ErrorBanner with
 * Retry; any other error shows the API's message inline in the composer. A
 * stream the server refuses (403/404) shows a warning banner.
 *
 * Views: Chat, and Trajectory (what the agent did, as a ledger with timing and
 * an inspector), switched by the tabs under the title and remembered per
 * session. Both read the same live state and both stay mounted: the inactive
 * one is hidden (and inert), so switching keeps the composer draft and the
 * chat's scroll position. The trajectory's "Show in chat" switches to Chat,
 * scrolls to the record's row (retrying for a few frames while it renders)
 * and marks it briefly; a row that never shows up gives a short notice.
 *
 * Settings: the composer's model and effort menus start at the session's
 * stored values; the next message carries only what changed. A refused change
 * (409 `session_setting_not_live`) keeps the draft, shows Agentry's message and
 * puts the menus back.
 */
import { Banner } from '@astryxdesign/core/Banner'
import { ChatLayout, ChatMessageList } from '@astryxdesign/core/Chat'
import { EmptyState } from '@astryxdesign/core/EmptyState'
import { HStack } from '@astryxdesign/core/HStack'
import { VStack } from '@astryxdesign/core/VStack'
import * as stylex from '@stylexjs/stylex'
import { useToast } from '@astryxdesign/core/Toast'
import { useRouter } from 'next/navigation'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { api, ApiError, isSignedOut, SETTING_NOT_LIVE } from '@/api/client'
import type { OAIAgentSession } from '@/api/types'
import type { MessageView } from '@/chat/reducer'
import { AppCommandError, chooseEffort, chooseModel, type AppCommandHandlers } from '@/commands/app-commands'
import { refreshCommands, useCommandList, useCommandsLoader } from '@/commands/commands-store'
import { REFRESH_MS } from '@/commands/list-store'
import { useSkillCommands, useSkillsLoader } from '@/skills/skills-store'
import { goToLogin, useConversation, type ActionAnswer, type ClosedReason } from '@/chat/use-conversation'
import { ErrorBanner, isUnavailable } from '@/ui/errors/ErrorBanner'
import { ChatTitleMenu } from '@/ui/shell/ChatTitleMenu'
import { RenameDialog, SESSIONS_CHANGED, type SessionRef } from '@/ui/shell/session-actions'
import { TopBar } from '@/ui/shell/TopBar'
import { useSessionView, ViewTabs, type ViewOption } from '@/ui/shell/ViewTabs'
import { buildTrajectory, type TrajectoryRecord } from '@/ui/trajectory/build-trajectory'
import { TrajectoryView } from '@/ui/trajectory/TrajectoryView'
import { useChatSettings, withSettings } from './chat-settings'
import type { UserFile } from '@/chat/attachments'
import { Composer } from './Composer'
import { ConnectionPill } from './ConnectionPill'
import { Message } from './Message'
import { scrollToItem } from './reveal'
import { SessionArtifacts } from './SessionArtifacts'
import { SubagentItems } from './SubagentCard'
import { Thinking } from './Thinking'
import { usePrefersReducedMotion } from './use-reduced-motion'

type View = 'chat' | 'trajectory'
const VIEWS: ViewOption<View>[] = [
  { value: 'chat', label: 'Chat' },
  { value: 'trajectory', label: 'Trajectory' },
]
const VIEW_VALUES = VIEWS.map((v) => v.value)
/** How long a row revealed from the trajectory stays marked. */
export const HIGHLIGHT_MS = 1_600
/** How many animation frames "Show in chat" waits for the row to render. */
export const REVEAL_FRAMES = 10

const styles = stylex.create({
  page: { blockSize: '100%', minBlockSize: 0 },
  chat: { flexGrow: 1, minBlockSize: 0 },
  views: { flexGrow: 1, minBlockSize: 0, position: 'relative' },
  // Both views stay mounted; the inactive one keeps its box (and its scroll position) but is not shown.
  inactive: { position: 'absolute', inset: 0, visibility: 'hidden', pointerEvents: 'none' },
})

const CLOSED_NOTICE: Record<ClosedReason, { title: string; description: string }> = {
  forbidden: {
    title: 'Live updates are not available',
    description: 'You do not have access to this chat’s event stream. Reload the page to try again.',
  },
  not_found: {
    title: 'Live updates stopped',
    description: 'Agentry no longer has an event stream for this chat. Reload the page to try again.',
  },
}

type Failure = { message: string; retry?: () => void; unavailable: boolean }

function messageOf(error: unknown): string {
  return error instanceof ApiError ? error.message : 'Something went wrong. Try again.'
}

/** For each notice, the user message that started its turn (what Retry resends). */
function retryTexts(items: MessageView[]): Map<string, string> {
  const out = new Map<string, string>()
  let lastUser: string | null = null
  for (const v of items) {
    if (v.kind === 'user') lastUser = v.text
    else if (v.kind === 'notice' && lastUser !== null) out.set(v.id, lastUser)
  }
  return out
}

export function Conversation({ sessionId }: { sessionId: string }) {
  const { state, loaded, ready, connection, closedReason, send, stop, answer, runCommand } = useConversation(sessionId)
  const router = useRouter()
  const toast = useToast()
  const [session, setSession] = useState<OAIAgentSession | null>(null)
  // The menu lists belong to this chat; they reload when the chat changes.
  useSkillsLoader(sessionId)
  useCommandsLoader(sessionId)
  const commands = useSkillCommands(sessionId)
  const dshCommands = useCommandList(sessionId)
  const [renaming, setRenaming] = useState<SessionRef | null>(null)
  const [models, setModels] = useState<string[] | null>(null)
  const settings = useChatSettings(session)
  const [missing, setMissing] = useState(false)
  const [failure, setFailure] = useState<Failure | null>(null)
  const [view, setView] = useSessionView<View>(sessionId, VIEW_VALUES, 'chat')
  const [selected, setSelected] = useState<string | null>(null)
  const [reveal, setReveal] = useState<string | null>(null)
  const [highlight, setHighlight] = useState<string | null>(null)
  // A message was just sent: show the waiting row until the session reports its turn.
  const [sent, setSent] = useState(false)
  // Notices already shown: a turn that fails or is stopped after the send adds a new one and ends the wait.
  const seenNotices = useRef<Set<string>>(new Set())
  const noticesAtSend = useRef<Set<string>>(new Set())
  const reducedMotion = usePrefersReducedMotion()
  // Something visibly happened already (a streaming thought or answer, a running tool): no waiting row.
  const liveActivity = state.items.some(
    (v) =>
      (v.kind === 'assistant' && v.streaming && v.text.trim() !== '') ||
      (v.kind === 'reasoning' && v.streaming && v.text.trim() !== '') ||
      (v.kind === 'tool' && v.status === 'running'),
  )
  useEffect(() => {
    for (const view of state.items) if (view.kind === 'notice') seenNotices.current.add(view.id)
  }, [state.items])
  const endedInNotice = state.items.some((v) => v.kind === 'notice' && !noticesAtSend.current.has(v.id))
  useEffect(() => {
    if (
      sent &&
      (state.status === 'in_progress' ||
        state.status === 'requires_action' ||
        liveActivity ||
        endedInNotice ||
        closedReason)
    ) {
      setSent(false)
    }
  }, [sent, state.status, liveActivity, endedInNotice, closedReason])
  // Same state as the chat, so the trajectory updates live with it.
  const model = session?.agent.model
  const trajectory = useMemo(
    () => buildTrajectory(state.turns, state.log, state.subagents, model ? { model } : {}),
    [state.turns, state.log, state.subagents, model],
  )
  // Each subagent's items as the hook last read them, for the cards in the chat.
  const subagentItems = useMemo(
    () => new Map(state.subagents.flatMap(({ subagent, items }) => (items ? [[subagent.id, items] as const] : []))),
    [state.subagents],
  )
  const showInChat = useCallback(
    (record: TrajectoryRecord) => {
      setView('chat')
      setReveal(record.chatItemId)
    },
    [setView],
  )
  // Once Chat is rendered, scroll to the revealed row and mark it.
  const highlightTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => {
    if (view !== 'chat' || reveal === null) return
    const id = reveal
    let frames = 0
    let handle = 0
    const attempt = () => {
      if (scrollToItem(id, !reducedMotion)) {
        setReveal(null)
        setHighlight(id)
        if (highlightTimer.current) clearTimeout(highlightTimer.current)
        highlightTimer.current = setTimeout(() => setHighlight(null), HIGHLIGHT_MS)
        return
      }
      // The row may not be rendered yet: try again on the next frames, then say so.
      frames += 1
      if (frames < REVEAL_FRAMES) {
        handle = requestAnimationFrame(attempt)
        return
      }
      setReveal(null)
      toast({ type: 'info', body: 'That step is not shown in the chat.', uniqueID: `reveal-${id}` })
    }
    attempt()
    return () => cancelAnimationFrame(handle)
  }, [view, reveal, reducedMotion, toast])
  useEffect(
    () => () => {
      if (highlightTimer.current) clearTimeout(highlightTimer.current)
    },
    [],
  )

  const loadSession = useCallback(async () => {
    try {
      setSession(await api.getSession(sessionId))
      setFailure(null)
    } catch (error) {
      if (isSignedOut(error)) return goToLogin()
      if (error instanceof ApiError && error.status === 404) return setMissing(true)
      setFailure({ message: messageOf(error), retry: () => void loadSession(), unavailable: isUnavailable(error) })
    }
  }, [sessionId])
  useEffect(() => {
    void loadSession()
  }, [loadSession])

  // The model menu offers the same models as a new chat; without them it still names the session's.
  useEffect(() => {
    let live = true
    api.models().then(
      (list) => live && setModels(list),
      (error: unknown) => {
        if (isSignedOut(error)) return goToLogin()
        if (live) setModels([])
      },
    )
    return () => {
      live = false
    }
  }, [])
  const modelOptions = useMemo(() => {
    const stored = session?.agent.model
    if (models === null) return null
    return stored && !models.includes(stored) ? [stored, ...models] : models
  }, [models, session?.agent.model])

  /** Runs an action; a failure becomes the banner (503) or the inline message. */
  const run = useCallback(async (call: () => Promise<void>) => {
    try {
      await call()
      setFailure(null)
    } catch (error) {
      if (!isSignedOut(error)) setFailure({ message: messageOf(error), retry: () => void run(call), unavailable: isUnavailable(error) })
      throw error
    }
  }, [])

  // The next message carries only the changed model / effort. Accepted: the session holds them now.
  // Refused (409 session_setting_not_live): nothing was queued, the draft stays, and the menus go back.
  const { change, revert } = settings
  const onSend = useCallback(
    async (text: string, files?: UserFile[]) => {
      noticesAtSend.current = new Set(seenNotices.current)
      setSent(true)
      try {
        await run(() => send(text, change, files))
      } catch (error) {
        setSent(false)
        if (error instanceof ApiError && error.code === SETTING_NOT_LIVE) revert()
        throw error
      }
      if (change.model || change.effort) {
        setSession((current) => (current ? withSettings(current, change) : current))
        revert()
      }
    },
    [run, send, change, revert],
  )
  /** Runs a backend slash command. A busy session or a stale catalog is a notice; the typed text stays. */
  const onRunCommand = useCallback(
    async (name: string, input: string) => {
      try {
        await runCommand(name, input)
        setFailure(null)
      } catch (error) {
        if (error instanceof ApiError && error.code === 'session_busy') throw new AppCommandError('Wait for the current turn to finish')
        if (error instanceof ApiError && error.code === 'command_not_found') {
          void refreshCommands(sessionId, Date.now() + REFRESH_MS)
          throw new AppCommandError('That command is no longer available')
        }
        if (!isSignedOut(error)) setFailure({ message: messageOf(error), retry: () => void onRunCommand(name, input).catch(() => {}), unavailable: isUnavailable(error) })
        throw error
      }
    },
    [runCommand, sessionId],
  )
  const { setModel, setEffort } = settings
  const appHandlers = useMemo<AppCommandHandlers>(() => {
    const startNew = async (arg: string) => {
      if (arg) {
        const created = await api.createSession({ text: arg, model: settings.model, ...(settings.effort === 'auto' ? {} : { effort: settings.effort }) })
        window.dispatchEvent(new Event(SESSIONS_CHANGED))
        router.push(`/c/${encodeURIComponent(created.id)}`)
      } else router.push('/')
    }
    return {
      new: startNew,
      clear: () => router.push('/'),
      model: (arg, { openMenu }) => {
        if (!arg) return openMenu('model') ? undefined : `Model: ${settings.model}`
        setModel(chooseModel(arg, modelOptions))
        return `Model set to ${arg}. It applies from your next message.`
      },
      effort: (arg, { openMenu }) => {
        if (!arg) return openMenu('effort') ? undefined : `Reasoning effort: ${settings.effort}`
        const effort = chooseEffort(arg, settings.efforts)
        setEffort(effort)
        return `Reasoning effort set to ${effort}. It applies from your next message.`
      },
      rename: () => setRenaming({ id: sessionId, metadata: session?.metadata }),
    }
  }, [router, settings.model, settings.effort, settings.efforts, setModel, setEffort, modelOptions, sessionId, session?.metadata])
  const onStop = useCallback(() => void run(stop).catch(() => {}), [run, stop])
  const onAnswer = useCallback((id: string, a: ActionAnswer) => answer(id, a), [answer])

  if (missing) {
    return (
      <VStack xstyle={styles.page}>
        <TopBar title="Chat not found" />
        <EmptyState title="This chat does not exist" description="It may have been deleted." headingLevel={2} />
      </VStack>
    )
  }

  const running = state.status === 'in_progress' || state.status === 'requires_action'
  const streaming = state.items.some((v) => v.kind === 'assistant' && v.streaming)
  const loading = !loaded || !ready
  // The history is still arriving, the message is being queued, or the model is thinking
  // before its first visible output. A closed stream or an unavailable server shows its own notice.
  const waiting = !closedReason && !failure?.unavailable && (loading || ((sent || state.status === 'in_progress') && !liveActivity))
  const retries = retryTexts(state.items)
  // A chat with nothing in it yet has no trajectory to switch to (unknown while its history loads).
  const blank = loaded && state.items.length === 0 && state.turns.length === 0
  const shown: View = blank ? 'chat' : view

  return (
    <VStack xstyle={styles.page}>
      <TopBar
        title={session && !blank ? <ChatTitleMenu sessionId={session.id} metadata={session.metadata} /> : undefined}
        end={
          <HStack gap={2} vAlign="center">
            <ConnectionPill connection={connection} />
          </HStack>
        }
        tabs={blank ? undefined : <ViewTabs views={VIEWS} value={view} onChange={setView} />}
      />
      {closedReason && <Banner status="warning" container="section" {...CLOSED_NOTICE[closedReason]} />}
      {failure?.unavailable && <ErrorBanner message={failure.message} onRetry={() => failure.retry?.()} />}
      <VStack xstyle={styles.views}>
        <VStack xstyle={[styles.chat, shown !== 'chat' && styles.inactive]} inert={shown !== 'chat'} data-testid="chat-pane">
          <ChatLayout
            xstyle={styles.chat}
            density="spacious"
            composer={
              <Composer
                onSend={onSend}
                onStop={onStop}
                isRunning={running}
                autoFocus
                commands={commands}
                dshCommands={dshCommands}
                appHandlers={appHandlers}
                onRunCommand={onRunCommand}
                settings={{
                  models: modelOptions,
                  model: settings.model,
                  onModelChange: settings.setModel,
                  effort: settings.effort,
                  efforts: settings.efforts,
                  onEffortChange: settings.setEffort,
                }}
                status={failure && !failure.unavailable ? { type: 'error', message: failure.message } : undefined}
              />
            }
          >
            <SubagentItems.Provider value={subagentItems}>
              <ChatMessageList isStreaming={streaming}>
                {state.items.map((view) => {
                  const retryText = retries.get(view.id)
                  return (
                    <Message
                      key={view.id}
                      view={view}
                      highlighted={highlight === view.id}
                      answer={onAnswer}
                      onRetry={retryText !== undefined && !running ? () => void onSend(retryText).catch(() => {}) : undefined}
                    />
                  )
                })}
                {waiting && <Thinking label={loading && state.items.length === 0 ? 'Loading conversation…' : 'Agentry is thinking…'} />}
                {/* The files the agent created, as a card at the end of the chat (claude.ai's
                    artifacts), not pinned to the composer. */}
                {sessionId && <SessionArtifacts sessionId={sessionId} enabled={ready} idle={!running} />}
              </ChatMessageList>
            </SubagentItems.Provider>
          </ChatLayout>
        </VStack>
        {!blank && (
          <VStack xstyle={[styles.chat, shown !== 'trajectory' && styles.inactive]} inert={shown !== 'trajectory'} data-testid="trajectory-pane">
            <TrajectoryView trajectory={trajectory} selectedId={shown === 'trajectory' ? selected : null} onSelect={setSelected} onShowInChat={showInChat} />
          </VStack>
        )}
      </VStack>
      <RenameDialog session={renaming} onClose={() => setRenaming(null)} />
    </VStack>
  )
}
