'use client'

/**
 * One open conversation: history plus the live stream (`useConversation`),
 * rendered as chat rows, with the composer pinned below. Errors: a 401 goes to
 * `/login` (the hook and client do this); a 503 shows the ErrorBanner with
 * Retry; any other error shows the API's message inline in the composer.
 */
import { ChatLayout, ChatMessageList } from '@astryxdesign/core/Chat'
import { EmptyState } from '@astryxdesign/core/EmptyState'
import { HStack } from '@astryxdesign/core/HStack'
import { Token } from '@astryxdesign/core/Token'
import { VStack } from '@astryxdesign/core/VStack'
import * as stylex from '@stylexjs/stylex'
import { useCallback, useEffect, useState } from 'react'
import { api, ApiError, isSignedOut } from '@/api/client'
import type { OAIAgentSession } from '@/api/types'
import type { MessageView } from '@/chat/reducer'
import { goToLogin, useConversation, type ActionAnswer } from '@/chat/use-conversation'
import { ErrorBanner, isUnavailable } from '@/ui/errors/ErrorBanner'
import { sessionTitle } from '@/ui/shell/group'
import { TopBar } from '@/ui/shell/TopBar'
import { Composer } from './Composer'
import { ConnectionPill } from './ConnectionPill'
import { Message } from './Message'

const styles = stylex.create({
  page: { blockSize: '100%', minBlockSize: 0 },
  chat: { flexGrow: 1, minBlockSize: 0 },
})

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
  const { state, connection, send, stop, answer } = useConversation(sessionId)
  const [session, setSession] = useState<OAIAgentSession | null>(null)
  const [missing, setMissing] = useState(false)
  const [failure, setFailure] = useState<Failure | null>(null)

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
          </HStack>
        }
      />
      {failure?.unavailable && <ErrorBanner message={failure.message} onRetry={() => failure.retry?.()} />}
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
    </VStack>
  )
}
