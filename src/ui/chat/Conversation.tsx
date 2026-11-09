'use client'

/**
 * One open conversation: history plus the live stream (`useConversation`),
 * rendered as chat rows, with the composer pinned below. Errors: a 401 goes to
 * `/login` (the hook and client do this); a 503 shows the ErrorBanner with
 * Retry; any other error shows the API's message inline in the composer. A
 * stream the server refuses (403/404) shows a warning banner.
 */
import { Banner } from '@astryxdesign/core/Banner'
import { Button } from '@astryxdesign/core/Button'
import { ChatLayout, ChatMessageList } from '@astryxdesign/core/Chat'
import { EmptyState } from '@astryxdesign/core/EmptyState'
import { HStack } from '@astryxdesign/core/HStack'
import { Icon } from '@astryxdesign/core/Icon'
import { Token } from '@astryxdesign/core/Token'
import { VStack } from '@astryxdesign/core/VStack'
import { QueueListIcon } from '@heroicons/react/24/outline'
import * as stylex from '@stylexjs/stylex'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { api, ApiError, isSignedOut } from '@/api/client'
import type { OAIAgentSession } from '@/api/types'
import type { MessageView } from '@/chat/reducer'
import { goToLogin, useConversation, type ActionAnswer, type ClosedReason } from '@/chat/use-conversation'
import { ErrorBanner, isUnavailable } from '@/ui/errors/ErrorBanner'
import { sessionTitle } from '@/ui/shell/group'
import { NARROW_QUERY, SidePanelLayout } from '@/ui/shell/SidePanel'
import { TopBar } from '@/ui/shell/TopBar'
import { buildTrace } from '@/ui/trace/build-trace'
import { TracePanel } from '@/ui/trace/TracePanel'
import { Composer } from './Composer'
import { ConnectionPill } from './ConnectionPill'
import { Message } from './Message'

const styles = stylex.create({
  page: { blockSize: '100%', minBlockSize: 0 },
  chat: { flexGrow: 1, minBlockSize: 0 },
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
  const { state, connection, closedReason, send, stop, answer } = useConversation(sessionId)
  const [session, setSession] = useState<OAIAgentSession | null>(null)
  const [missing, setMissing] = useState(false)
  const [failure, setFailure] = useState<Failure | null>(null)
  const [traceOpen, setTraceOpen] = useState(false)
  // Same state as the conversation, so the trace updates live with it.
  const trace = useMemo(() => buildTrace(state.turns, state.log), [state.turns, state.log])
  // In the drawer (narrow screens) a chosen step closes the trace so the row is visible.
  const onStepSelect = useCallback(() => {
    if (window.matchMedia?.(NARROW_QUERY).matches) setTraceOpen(false)
  }, [])

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

  return (
    <VStack xstyle={styles.page}>
      <TopBar
        title={session ? sessionTitle(session) : 'Chat'}
        end={
          <HStack gap={2} vAlign="center">
            <ConnectionPill connection={connection} />
            {session && <Token size="sm" label={session.agent.model} description="Model" />}
            <Button
              label="Trace"
              variant="ghost"
              size="sm"
              icon={<Icon icon={QueueListIcon} />}
              aria-pressed={traceOpen}
              onClick={() => setTraceOpen((open) => !open)}
            />
          </HStack>
        }
      />
      {closedReason && <Banner status="warning" container="section" {...CLOSED_NOTICE[closedReason]} />}
      {failure?.unavailable && <ErrorBanner message={failure.message} onRetry={() => failure.retry?.()} />}
      <SidePanelLayout
        title="Trace"
        isOpen={traceOpen}
        onOpenChange={setTraceOpen}
        panel={<TracePanel turns={trace} onStepSelect={onStepSelect} />}
      >
        <ChatLayout
          xstyle={styles.chat}
          density="spacious"
          composer={
            <Composer
              onSend={onSend}
              onStop={onStop}
              isRunning={running}
              autoFocus
              status={failure && !failure.unavailable ? { type: 'error', message: failure.message } : undefined}
            />
          }
        >
          <ChatMessageList isStreaming={streaming}>
            {state.items.map((view) => {
              const retryText = retries.get(view.id)
              return (
                <Message
                  key={view.id}
                  view={view}
                  answer={onAnswer}
                  onRetry={retryText !== undefined && !running ? () => void onSend(retryText).catch(() => {}) : undefined}
                />
              )
            })}
          </ChatMessageList>
        </ChatLayout>
      </SidePanelLayout>
    </VStack>
  )
}
