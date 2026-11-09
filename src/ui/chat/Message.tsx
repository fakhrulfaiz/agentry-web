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

/** The attribute the trace finds a row by (`data-item-id`, the view id); top-level rows only. */
export const ITEM_ANCHOR = 'data-item-id'

function AssistantRow({ anchor, children }: { anchor?: string; children: ReactNode }) {
  return (
    <ChatMessage sender="assistant" name="" data-item-id={anchor}>
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
  depth = 1,
}: {
  view: MessageView
  answer(actionId: string, a: ActionAnswer): Promise<void>
  onRetry?: () => void
  /** Subagent nesting: 1 in the conversation, one more inside each expanded subagent card. */
  depth?: number
}) {
  // Subagent items reuse the parent's item ids, so only top-level rows are anchors.
  const anchor = depth === 1 ? view.id : undefined
  switch (view.kind) {
    case 'user':
      return (
        <ChatMessage sender="user" name="" data-item-id={anchor}>
          <ChatMessageBubble>
            <Text xstyle={styles.userText}>{view.text}</Text>
          </ChatMessageBubble>
        </ChatMessage>
      )
    case 'assistant':
      // A step that was only reasoning (or only tool calls) leaves an empty message: show nothing.
      if (!view.text) return null
      return (
        <AssistantRow anchor={anchor}>
          <AssistantText text={view.text} streaming={view.streaming} />
        </AssistantRow>
      )
    case 'reasoning':
      return (
        <AssistantRow anchor={anchor}>
          <ReasoningBlock text={view.text} streaming={view.streaming} />
        </AssistantRow>
      )
    case 'tool':
      return (
        <AssistantRow anchor={anchor}>
          <ToolCard view={view} />
        </AssistantRow>
      )
    case 'subagent':
      return (
        <AssistantRow anchor={anchor}>
          <SubagentCard view={view} depth={depth} />
        </AssistantRow>
      )
    case 'notice':
      return (
        <AssistantRow anchor={anchor}>
          <Notice view={view} onRetry={onRetry} />
        </AssistantRow>
      )
    case 'action': {
      const action = view.action
      if (action.type !== 'approval') {
        const what = action.type === 'function_call' ? `Waiting for ${action.name} to run` : 'Waiting for the environment to connect'
        return (
          <AssistantRow anchor={anchor}>
            <Text type="supporting">{what}</Text>
          </AssistantRow>
        )
      }
      return (
        <AssistantRow anchor={anchor}>
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
