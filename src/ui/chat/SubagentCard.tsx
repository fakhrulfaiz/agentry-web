'use client'

/**
 * A subagent the turn delegated to. Collapsed: its name (the delegating call's
 * description), the model it ran, status and duration. Approvals the child is
 * waiting on show under the header, open or closed, and answer through the
 * parent session like any approval. Expanded: what it was asked (the call's
 * prompt, itself collapsed until opened), then the child's own items,
 * rendered with the same message, thinking and tool views. The items come
 * from the conversation's own subagent reads (`SubagentItems`, which the hook
 * keeps current while the child runs), so a card never polls by itself. A
 * card whose items are not provided (a nested child) reads them once when
 * expanded and again when its status changes. Cards nest up to
 * `MAX_SUBAGENT_DEPTH`; deeper ones do not expand.
 */
import { Card } from '@astryxdesign/core/Card'
import { Collapsible } from '@astryxdesign/core/Collapsible'
import { HStack } from '@astryxdesign/core/HStack'
import { IconButton } from '@astryxdesign/core/IconButton'
import { Icon } from '@astryxdesign/core/Icon'
import { StackItem } from '@astryxdesign/core/Layout'
import { Spinner } from '@astryxdesign/core/Spinner'
import { Text } from '@astryxdesign/core/Text'
import { Token } from '@astryxdesign/core/Token'
import { VStack } from '@astryxdesign/core/VStack'
import { ArrowTopRightOnSquareIcon, BookmarkIcon, UserGroupIcon } from '@heroicons/react/24/outline'
import { setPendingDraft } from '@/agents/draft'
import { subagentDraft } from '@/agents/from-subagent'
import * as stylex from '@stylexjs/stylex'
import { createContext, useContext, useEffect, useMemo, useState } from 'react'
import { api, ApiError } from '@/api/client'
import type { OAIApprovalAction, StoredSessionItem } from '@/api/types'
import { applyItems, initialState, type MessageView } from '@/chat/reducer'
import type { ActionAnswer } from '@/chat/use-conversation'
import { usePreviewPanel } from '@/preview/store'
import { ApprovalCard } from './ApprovalCard'
import { Message } from './Message'
import { QuestionCard } from './QuestionCard'

export type SubagentView = Extract<MessageView, { kind: 'subagent' }>

export const MAX_SUBAGENT_DEPTH = 3

/** Subagent id → its saved items, as the conversation last read them. */
export const SubagentItems = createContext<ReadonlyMap<string, StoredSessionItem[]>>(new Map())

/** Subagent id → the approvals and questions it is waiting on (actions with `subagent_id`). */
export const SubagentActions = createContext<ReadonlyMap<string, OAIApprovalAction[]>>(new Map())

const LABEL: Record<string, string> = {
  queued: 'Queued',
  in_progress: 'Working',
  completed: 'Done',
  failed: 'Failed',
  cancelled: 'Cancelled',
}
const COLOR = { completed: 'green', failed: 'red', cancelled: 'gray' } as const

const styles = stylex.create({
  // As in ReasoningBlock: the header takes the column's width, never its content's.
  header: { contain: 'inline-size', minInlineSize: 0 },
  fixed: { flexShrink: 0 },
  name: { minInlineSize: 0, overflow: 'hidden' },
  model: { flexShrink: 1, minInlineSize: 0, overflow: 'hidden' },
})

/** `17s`, `2m 5s`. */
export function formatDuration(seconds: number): string {
  const s = Math.max(0, Math.round(seconds))
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`
}

const noAnswer = async () => {}

/** The child's items as conversation views (they carry `subagent_id`, which `applyItems` would skip). */
function childViews(subagentId: string, items: StoredSessionItem[]): MessageView[] {
  const own = items.map(({ subagent_id: _child, ...item }) => item as StoredSessionItem)
  return applyItems(initialState(subagentId), own).items
}

function Header({ view }: { view: SubagentView }) {
  const running = view.status === 'in_progress' || view.status === 'queued'
  const duration = view.startedAt !== undefined && view.endedAt !== undefined ? formatDuration(view.endedAt - view.startedAt) : null
  return (
    <HStack gap={2} vAlign="center" xstyle={styles.header}>
      <StackItem xstyle={styles.fixed}>
        <Icon icon={UserGroupIcon} color="secondary" size="sm" />
      </StackItem>
      <StackItem size="fill" xstyle={styles.name}>
        <Text maxLines={1}>{view.name}</Text>
      </StackItem>
      {view.model && (
        <StackItem xstyle={styles.model}>
          <Text type="supporting" maxLines={1} data-testid="subagent-model">
            {view.model}
          </Text>
        </StackItem>
      )}
      {duration && (
        <StackItem xstyle={styles.fixed}>
          <Text type="supporting" hasTabularNumbers>
            {duration}
          </Text>
        </StackItem>
      )}
      {running && <Spinner size="sm" aria-label="Working" />}
      <StackItem xstyle={styles.fixed}>
        <Token size="sm" label={LABEL[view.status] ?? view.status} color={COLOR[view.status as keyof typeof COLOR] ?? 'default'} />
      </StackItem>
    </HStack>
  )
}

export function Activity({ view, depth }: { view: SubagentView; depth: number }) {
  const provided = useContext(SubagentItems).get(view.subagentId)
  const [fetched, setFetched] = useState<StoredSessionItem[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (provided) return
    let cancelled = false
    api.subagentItems(view.sessionId, view.subagentId).then(
      (items) => {
        if (cancelled) return
        setFetched(items)
        setError(null)
      },
      (e: unknown) => {
        if (!cancelled) setError(e instanceof ApiError ? e.message : 'Could not load the subagent’s activity.')
      },
    )
    return () => {
      cancelled = true
    }
    // A status change (it finished) loads once more.
  }, [provided, view.sessionId, view.subagentId, view.status])

  const items = provided ?? fetched
  const views = useMemo(() => (items ? childViews(view.subagentId, items) : null), [items, view.subagentId])
  if (error && !views) return <Text type="supporting">{error}</Text>
  if (!views) return <Spinner size="sm" aria-label="Loading" />
  if (views.length === 0) return <Text type="supporting">No activity yet.</Text>
  return (
    <VStack gap={2} data-testid="subagent-activity">
      {views.map((child) => (
        <Message key={child.id} view={child} answer={noAnswer} depth={depth + 1} />
      ))}
    </VStack>
  )
}

/** What the subagent was asked, collapsed until opened. */
export function Prompt({ text }: { text: string }) {
  return (
    <Collapsible defaultIsOpen={false} chevronPosition="start" trigger={<Text type="supporting">Prompt</Text>} data-testid="subagent-prompt">
      <Text type="supporting">{text}</Text>
    </Collapsible>
  )
}

/** Approvals and questions the child is waiting on, answered through the parent session. */
export function Waiting({ actions, answer }: { actions: OAIApprovalAction[]; answer(actionId: string, a: ActionAnswer): Promise<void> }) {
  return (
    <VStack gap={2} data-testid="subagent-actions">
      {actions.map((action) =>
        action.kind === 'user_question' ? (
          <QuestionCard key={action.id} action={action} answer={answer} />
        ) : (
          <ApprovalCard key={action.id} action={action} answer={answer} />
        ),
      )}
    </VStack>
  )
}

/** What a subagent was asked and what it did so far: the card's expanded body, also the panel's subagent tab. */
export function SubagentTranscript({ view, depth = 1 }: { view: SubagentView; depth?: number }) {
  return (
    <VStack gap={2}>
      {view.prompt && <Prompt text={view.prompt} />}
      <Activity view={view} depth={depth} />
    </VStack>
  )
}

export function SubagentCard({
  view,
  depth = 1,
  answer = noAnswer,
}: {
  view: SubagentView
  depth?: number
  /** Answers an approval or question the child is waiting on (the conversation's own answer path). */
  answer?(actionId: string, a: ActionAnswer): Promise<void>
}) {
  const [open, setOpen] = useState(false)
  const { actions: panel } = usePreviewPanel()
  const running = view.status === 'in_progress' || view.status === 'queued'
  const actions = useContext(SubagentActions).get(view.subagentId) ?? []
  const waiting = actions.length > 0 && <Waiting actions={actions} answer={answer} />
  if (depth >= MAX_SUBAGENT_DEPTH) {
    return (
      <Card padding={3} width="100%" data-testid="subagent-card">
        <VStack gap={2}>
          <Header view={view} />
          {waiting}
        </VStack>
      </Card>
    )
  }
  return (
    <Card padding={3} width="100%" data-testid="subagent-card">
      <VStack gap={2}>
        <HStack gap={1} vAlign="start">
          <StackItem size="fill" xstyle={styles.name}>
            <Collapsible isOpen={open} onOpenChange={setOpen} chevronPosition="start" trigger={<Header view={view} />}>
              {open && <SubagentTranscript view={view} depth={depth} />}
            </Collapsible>
          </StackItem>
          <StackItem xstyle={styles.fixed}>
            <HStack gap={0}>
              {!running && view.prompt && (
                <IconButton
                  label="Save as agent"
                  tooltip="Save as agent"
                  variant="ghost"
                  size="sm"
                  icon={<Icon icon={BookmarkIcon} size="sm" />}
                  href="/agents?new=1&draft=1"
                  onClick={() => setPendingDraft(subagentDraft({ name: view.name, prompt: view.prompt ?? '', model: view.model }))}
                />
              )}
              <IconButton label="Open in panel" tooltip="Open in panel" variant="ghost" size="sm" icon={<Icon icon={ArrowTopRightOnSquareIcon} size="sm" />} onClick={() => panel.openView(`sub:${view.subagentId}`, view.name)} />
            </HStack>
          </StackItem>
        </HStack>
        {waiting}
      </VStack>
    </Card>
  )
}
