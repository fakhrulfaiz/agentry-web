'use client'

/**
 * A subagent the turn delegated to. Collapsed: its name (the delegating call's
 * description), status and duration. Expanded: the child's own items
 * (`GET .../subagents/{id}/items`), rendered with the same message, thinking
 * and tool views, reloaded every 2s while the child runs. Cards nest up to
 * `MAX_SUBAGENT_DEPTH`; deeper ones do not expand.
 */
import { Card } from '@astryxdesign/core/Card'
import { Collapsible } from '@astryxdesign/core/Collapsible'
import { HStack } from '@astryxdesign/core/HStack'
import { Icon } from '@astryxdesign/core/Icon'
import { StackItem } from '@astryxdesign/core/Layout'
import { Spinner } from '@astryxdesign/core/Spinner'
import { Text } from '@astryxdesign/core/Text'
import { Token } from '@astryxdesign/core/Token'
import { VStack } from '@astryxdesign/core/VStack'
import { UserGroupIcon } from '@heroicons/react/24/outline'
import * as stylex from '@stylexjs/stylex'
import { useEffect, useState } from 'react'
import { api, ApiError } from '@/api/client'
import type { StoredSessionItem } from '@/api/types'
import { applyItems, initialState, type MessageView } from '@/chat/reducer'
import { Message } from './Message'

type SubagentView = Extract<MessageView, { kind: 'subagent' }>

export const MAX_SUBAGENT_DEPTH = 3
const RELOAD_MS = 2_000

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

function Activity({ view, depth }: { view: SubagentView; depth: number }) {
  const [views, setViews] = useState<MessageView[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const running = view.status === 'in_progress' || view.status === 'queued'

  useEffect(() => {
    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | undefined
    const load = async () => {
      try {
        const items = await api.subagentItems(view.sessionId, view.subagentId)
        if (cancelled) return
        setViews(childViews(view.subagentId, items))
        setError(null)
      } catch (e) {
        if (!cancelled) setError(e instanceof ApiError ? e.message : 'Could not load the subagent’s activity.')
      }
      if (!cancelled && running) timer = setTimeout(() => void load(), RELOAD_MS)
    }
    void load()
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
    // A status change (it finished) loads once more.
  }, [view.sessionId, view.subagentId, view.status, running])

  if (error) return <Text type="supporting">{error}</Text>
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

export function SubagentCard({ view, depth = 1 }: { view: SubagentView; depth?: number }) {
  const [open, setOpen] = useState(false)
  if (depth >= MAX_SUBAGENT_DEPTH) {
    return (
      <Card padding={3} width="100%" data-testid="subagent-card">
        <Header view={view} />
      </Card>
    )
  }
  return (
    <Card padding={3} width="100%" data-testid="subagent-card">
      <Collapsible isOpen={open} onOpenChange={setOpen} chevronPosition="start" trigger={<Header view={view} />}>
        {open && <Activity view={view} depth={depth} />}
      </Collapsible>
    </Card>
  )
}
