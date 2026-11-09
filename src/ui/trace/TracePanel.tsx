'use client'

/**
 * The per-turn trace: each turn with its status, duration and token usage,
 * then its steps (message, thinking, tool, delegation, answer) in order.
 * Selecting a step scrolls the conversation to that item's row. Built by the
 * caller from the live conversation state, so it updates with it.
 */
import { EmptyState } from '@astryxdesign/core/EmptyState'
import { Heading } from '@astryxdesign/core/Heading'
import { HStack } from '@astryxdesign/core/HStack'
import { Icon } from '@astryxdesign/core/Icon'
import { StackItem } from '@astryxdesign/core/Layout'
import { List, ListItem } from '@astryxdesign/core/List'
import { Text } from '@astryxdesign/core/Text'
import { Token } from '@astryxdesign/core/Token'
import { VStack } from '@astryxdesign/core/VStack'
import {
  ChatBubbleLeftEllipsisIcon,
  ChatBubbleLeftIcon,
  LightBulbIcon,
  UserGroupIcon,
  WrenchScrewdriverIcon,
} from '@heroicons/react/24/outline'
import type { OAITokenUsage } from '@/api/types'
import { ITEM_ANCHOR } from '@/ui/chat/Message'
import { formatDuration } from '@/ui/chat/SubagentCard'
import { usePrefersReducedMotion } from '@/ui/chat/use-reduced-motion'
import type { TraceStep, TraceTurn } from './build-trace'

const KIND: Record<TraceStep['kind'], { name: string; icon: typeof LightBulbIcon }> = {
  user: { name: 'Message', icon: ChatBubbleLeftIcon },
  reasoning: { name: 'Thinking', icon: LightBulbIcon },
  tool: { name: 'Tool', icon: WrenchScrewdriverIcon },
  assistant: { name: 'Answer', icon: ChatBubbleLeftEllipsisIcon },
  subagent: { name: 'Subagent', icon: UserGroupIcon },
}

const STATUS: Record<string, { label: string; color?: 'green' | 'red' | 'gray' }> = {
  queued: { label: 'Queued' },
  in_progress: { label: 'Running' },
  waiting: { label: 'Waiting' },
  completed: { label: 'Done', color: 'green' },
  failed: { label: 'Failed', color: 'red' },
  cancelled: { label: 'Stopped', color: 'gray' },
}

const count = new Intl.NumberFormat('en')

export function formatUsage(usage: OAITokenUsage): string {
  return `${count.format(usage.total_tokens)} tokens · ${count.format(usage.input_tokens)} in · ${count.format(usage.output_tokens)} out`
}

/** Scrolls the conversation row of `itemId` into view; false when it is not rendered. */
export function scrollToItem(itemId: string, smooth = true): boolean {
  const row = Array.from(document.querySelectorAll<HTMLElement>(`[${ITEM_ANCHOR}]`)).find((el) => el.getAttribute(ITEM_ANCHOR) === itemId)
  if (!row) return false
  row.scrollIntoView({ block: 'center', behavior: smooth ? 'smooth' : 'auto' })
  return true
}

function TurnSection({ turn, index, onSelect }: { turn: TraceTurn; index: number; onSelect(step: TraceStep): void }) {
  const status = STATUS[turn.status] ?? { label: turn.status }
  const duration = turn.endedAt !== undefined ? formatDuration(turn.endedAt - turn.startedAt) : null
  return (
    <VStack gap={1} as="section" aria-label={`Turn ${index + 1}`} data-testid="trace-turn">
      <HStack gap={2} vAlign="center">
        <StackItem size="fill">
          <Heading level={3}>Turn {index + 1}</Heading>
        </StackItem>
        {duration && (
          <Text type="supporting" hasTabularNumbers>
            {duration}
          </Text>
        )}
        <Token size="sm" label={status.label} color={status.color} />
      </HStack>
      {turn.usage && (
        <Text type="supporting" hasTabularNumbers>
          {formatUsage(turn.usage)}
        </Text>
      )}
      {turn.steps.length === 0 ? (
        <Text type="supporting">No steps yet</Text>
      ) : (
        <List density="compact">
          {turn.steps.map((step) => (
            <ListItem
              key={step.itemId}
              label={step.label}
              description={KIND[step.kind].name}
              startContent={<Icon icon={KIND[step.kind].icon} size="sm" color="secondary" />}
              onClick={() => onSelect(step)}
              data-testid="trace-step"
            />
          ))}
        </List>
      )}
    </VStack>
  )
}

export function TracePanel({ turns, onStepSelect }: { turns: TraceTurn[]; onStepSelect?(step: TraceStep): void }) {
  const reducedMotion = usePrefersReducedMotion()
  const select = (step: TraceStep) => {
    onStepSelect?.(step)
    scrollToItem(step.itemId, !reducedMotion)
  }
  if (turns.length === 0) {
    return <EmptyState title="No turns yet" description="Each turn and its steps show up here." headingLevel={3} />
  }
  return (
    <VStack gap={4}>
      {turns.map((turn, index) => (
        <TurnSection key={turn.id} turn={turn} index={index} onSelect={select} />
      ))}
    </VStack>
  )
}
