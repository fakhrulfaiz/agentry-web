'use client'

/**
 * One conversation view (`MessageView`) as a chat row: user bubble (right),
 * assistant Markdown (full width, streamed), reasoning, tool, delegation,
 * approval / question, or notice.
 */
import { ChatMessage, ChatMessageBubble } from '@astryxdesign/core/Chat'
import { Text } from '@astryxdesign/core/Text'
import { VStack } from '@astryxdesign/core/VStack'
import * as stylex from '@stylexjs/stylex'
import type { ReactNode } from 'react'
import type { MessageView } from '@/chat/reducer'
import type { ActionAnswer } from '@/chat/use-conversation'
import { ApprovalCard } from './ApprovalCard'
import { Markdown } from './Markdown'
import { Notice } from './Notice'
import { QuestionCard } from './QuestionCard'
import { ReasoningBlock } from './ReasoningBlock'
import { SubagentCard } from './SubagentCard'
import { ToolCard } from './ToolCard'
import { usePrefersReducedMotion } from './use-reduced-motion'

const styles = stylex.create({ userText: { whiteSpace: 'pre-wrap' } })

function AssistantRow({ children }: { children: ReactNode }) {
  return (
    <ChatMessage sender="assistant" name="">
      <ChatMessageBubble variant="ghost" width="100%">
        {children}
      </ChatMessageBubble>
    </ChatMessage>
  )
}

function AssistantText({ text, streaming }: { text: string; streaming: boolean }) {
  const reducedMotion = usePrefersReducedMotion()
  return (
    <VStack aria-live={streaming ? 'polite' : undefined} aria-busy={streaming || undefined} data-testid="assistant-message">
      <Markdown text={text} isStreaming={streaming && !reducedMotion} />
    </VStack>
  )
}

export function Message({
  view,
  answer,
  onRetry,
}: {
  view: MessageView
  answer(actionId: string, a: ActionAnswer): Promise<void>
  onRetry?: () => void
}) {
  switch (view.kind) {
    case 'user':
      return (
        <ChatMessage sender="user" name="">
          <ChatMessageBubble>
            <Text xstyle={styles.userText}>{view.text}</Text>
          </ChatMessageBubble>
        </ChatMessage>
      )
    case 'assistant':
      return (
        <AssistantRow>
          <AssistantText text={view.text} streaming={view.streaming} />
        </AssistantRow>
      )
    case 'reasoning':
      return (
        <AssistantRow>
          <ReasoningBlock text={view.text} />
        </AssistantRow>
      )
    case 'tool':
      return (
        <AssistantRow>
          <ToolCard view={view} />
        </AssistantRow>
      )
    case 'subagent':
      return (
        <AssistantRow>
          <SubagentCard view={view} />
        </AssistantRow>
      )
    case 'notice':
      return (
        <AssistantRow>
          <Notice view={view} onRetry={onRetry} />
        </AssistantRow>
      )
    case 'action': {
      const action = view.action
      if (action.type !== 'approval') {
        const what = action.type === 'function_call' ? `Waiting for ${action.name} to run` : 'Waiting for the environment to connect'
        return (
          <AssistantRow>
            <Text type="supporting">{what}</Text>
          </AssistantRow>
        )
      }
      return (
        <AssistantRow>
          {action.kind === 'user_question' ? (
            <QuestionCard action={action} answer={answer} />
          ) : (
            <ApprovalCard action={action} answer={answer} />
          )}
        </AssistantRow>
      )
    }
  }
}
