'use client'

/**
 * One conversation view (`MessageView`) as a chat row: user bubble (right, see `UserMessage`),
 * assistant Markdown (full width, streamed), reasoning, tool, delegation,
 * approval / question, or notice.
 */
import { ChatMessage, ChatMessageBubble } from '@astryxdesign/core/Chat'
import { HStack } from '@astryxdesign/core/HStack'
import { Icon } from '@astryxdesign/core/Icon'
import { Text } from '@astryxdesign/core/Text'
import { CheckCircleIcon } from '@heroicons/react/16/solid'
import { VStack } from '@astryxdesign/core/VStack'
import { colorVars, radiusVars } from '@astryxdesign/core/theme/tokens.stylex'
import * as stylex from '@stylexjs/stylex'
import type { ReactNode } from 'react'
import type { MessageView } from '@/chat/reducer'
import type { ActionAnswer } from '@/chat/use-conversation'
import { ApprovalCard } from './ApprovalCard'
import { CommandResult } from './CommandResult'
import { appLabel } from './ConnectCard'
import { AppLogo } from '@/ui/shared/AppLogo'
import { Markdown } from './Markdown'
import { Notice } from './Notice'
import { QuestionCard } from './QuestionCard'
import { ReasoningBlock } from './ReasoningBlock'
import { SubagentCard } from './SubagentCard'
import { ToolCard } from './ToolCard'
import { UserMessage } from './UserMessage'
import { usePrefersReducedMotion } from './use-reduced-motion'

const styles = stylex.create({
  // A row revealed from the trajectory, briefly.
  highlight: { backgroundColor: colorVars['--color-accent-muted'], borderRadius: radiusVars['--radius-container'] },
})

/**
 * Consecutive tool calls as one tight list in a single row, instead of one chat row each (each row brings the
 * message list's full gap, which made a run of quick lookups take a screen). Other views go through `row`.
 */
export function renderRows(views: readonly MessageView[], row: (view: MessageView) => ReactNode): ReactNode[] {
  const out: ReactNode[] = []
  let run: Extract<MessageView, { kind: 'tool' }>[] = []
  const flush = () => {
    if (run.length === 1) out.push(row(run[0]!))
    else if (run.length > 1) {
      const first = run[0]!
      out.push(
        <AssistantRow key={`tools-${first.id}`}>
          <VStack gap={0}>{run.map((view) => <ToolCard key={view.id} view={view} anchor={view.id} />)}</VStack>
        </AssistantRow>,
      )
    }
    run = []
  }
  for (const view of views) {
    if (view.kind === 'tool') run.push(view)
    else {
      flush()
      out.push(row(view))
    }
  }
  flush()
  return out
}

/** The attribute the trace finds a row by (`data-item-id`, the view id); top-level rows only. */
export const ITEM_ANCHOR = 'data-item-id'

function AssistantRow({ anchor, highlighted, children }: { anchor?: string; highlighted?: boolean; children: ReactNode }) {
  return (
    <ChatMessage sender="assistant" name="" data-item-id={anchor} xstyle={highlighted ? styles.highlight : undefined}>
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
  onSend,
  depth = 1,
  highlighted = false,
}: {
  view: MessageView
  answer(actionId: string, a: ActionAnswer): Promise<void>
  onRetry?: () => void
  /** Sends a message (a user row's Retry and Edit); absent while a turn runs. */
  onSend?: (text: string) => void
  /** Subagent nesting: 1 in the conversation, one more inside each expanded subagent card. */
  depth?: number
  /** Briefly marks the row (revealed from the trajectory). */
  highlighted?: boolean
}) {
  // Subagent items reuse the parent's item ids, so only top-level rows are anchors.
  const anchor = depth === 1 ? view.id : undefined
  switch (view.kind) {
    case 'user': {
      // The API's connect watcher posts "App connected: <app> (<account>). …" as the next input: a note, not the user's words.
      const connected = /^App connected: ([a-z0-9_-]+)(?: \((.+?)\))?\./u.exec(view.text)
      if (connected) {
        const [, app = '', account] = connected
        return (
          <AssistantRow anchor={anchor}>
            <HStack gap={2} vAlign="center" data-testid="app-connected-note">
              <AppLogo slug={app} name={appLabel(app)} size={16} />
              <Text type="supporting" color="secondary">
                {appLabel(app)} connected{account ? ` (${account})` : ''}, continuing
              </Text>
              <Icon icon={CheckCircleIcon} size="sm" color="success" />
            </HStack>
          </AssistantRow>
        )
      }
      return <UserMessage view={view} anchor={anchor} highlight={highlighted ? styles.highlight : undefined} onSend={onSend} />
    }
    case 'assistant':
      // A step that was only reasoning (or only tool calls) leaves an empty message: show nothing.
      if (!view.text) return null
      return (
        <AssistantRow anchor={anchor} highlighted={highlighted}>
          <AssistantText text={view.text} streaming={view.streaming} />
        </AssistantRow>
      )
    case 'reasoning':
      return (
        <AssistantRow anchor={anchor} highlighted={highlighted}>
          <ReasoningBlock text={view.text} streaming={view.streaming} />
        </AssistantRow>
      )
    case 'tool':
      return (
        <AssistantRow anchor={anchor} highlighted={highlighted}>
          <ToolCard view={view} />
        </AssistantRow>
      )
    case 'subagent':
      return (
        <AssistantRow anchor={anchor} highlighted={highlighted}>
          <SubagentCard view={view} depth={depth} answer={answer} />
        </AssistantRow>
      )
    case 'command':
      return (
        <AssistantRow anchor={anchor} highlighted={highlighted}>
          <CommandResult view={view} />
        </AssistantRow>
      )
    case 'notice':
      return (
        <AssistantRow anchor={anchor} highlighted={highlighted}>
          <Notice view={view} onRetry={onRetry} />
        </AssistantRow>
      )
    case 'action': {
      const action = view.action
      if (action.type !== 'approval') {
        const what = action.type === 'function_call' ? `Waiting for ${action.name} to run` : 'Waiting for the environment to connect'
        return (
          <AssistantRow anchor={anchor} highlighted={highlighted}>
            <Text type="supporting">{what}</Text>
          </AssistantRow>
        )
      }
      return (
        <AssistantRow anchor={anchor} highlighted={highlighted}>
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
