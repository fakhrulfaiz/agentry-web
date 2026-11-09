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
 */
import { Banner } from '@astryxdesign/core/Banner'
import { ChatLayout, ChatMessageList } from '@astryxdesign/core/Chat'
import { EmptyState } from '@astryxdesign/core/EmptyState'
import { HStack } from '@astryxdesign/core/HStack'
import { VStack } from '@astryxdesign/core/VStack'
import * as stylex from '@stylexjs/stylex'
import { useToast } from '@astryxdesign/core/Toast'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { api, ApiError, isSignedOut } from '@/api/client'
import type { OAIAgentSession } from '@/api/types'
import type { MessageView } from '@/chat/reducer'
import { goToLogin, useConversation, type ActionAnswer, type ClosedReason } from '@/chat/use-conversation'
import { ErrorBanner, isUnavailable } from '@/ui/errors/ErrorBanner'
import { ChatTitleMenu } from '@/ui/shell/ChatTitleMenu'
import { TopBar } from '@/ui/shell/TopBar'
import { useSessionView, ViewTabs, type ViewOption } from '@/ui/shell/ViewTabs'
import { buildTrajectory, type TrajectoryRecord } from '@/ui/trajectory/build-trajectory'
import { TrajectoryView } from '@/ui/trajectory/TrajectoryView'
import { Composer, type ComposerSettings, type EffortChoice } from './Composer'
import { ConnectionPill } from './ConnectionPill'
import { Message } from './Message'
import { scrollToItem } from './reveal'
import { SubagentItems } from './SubagentCard'
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

/**
 * Agentry takes the model and reasoning effort when a chat starts; a follow-up
 * message cannot carry them, and a session update does not reach the running
 * agent. So an open chat shows them read-only.
 */
export const SETTINGS_HINT = 'Model and reasoning effort are set when a chat starts; changing them mid-chat needs backend support'
const EFFORT_CHOICES = new Set<string>(['low', 'medium', 'high'])

function settingsOf(session: OAIAgentSession | null): ComposerSettings {
  const effort = session?.agent.reasoning?.effort
  return {
    models: null,
    model: session?.agent.model ?? '',
    effort: effort && EFFORT_CHOICES.has(effort) ? (effort as EffortChoice) : 'auto',
    hint: SETTINGS_HINT,
  }
}

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
  const { state, loaded, connection, closedReason, send, stop, answer } = useConversation(sessionId)
  const toast = useToast()
  const [session, setSession] = useState<OAIAgentSession | null>(null)
  const [missing, setMissing] = useState(false)
  const [failure, setFailure] = useState<Failure | null>(null)
  const [view, setView] = useSessionView<View>(sessionId, VIEW_VALUES, 'chat')
  const [selected, setSelected] = useState<string | null>(null)
  const [reveal, setReveal] = useState<string | null>(null)
  const [highlight, setHighlight] = useState<string | null>(null)
  const reducedMotion = usePrefersReducedMotion()
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

  const onSend = useCallback((text: string) => run(() => send(text)), [run, send])
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
                settings={settingsOf(session)}
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
    </VStack>
  )
}
