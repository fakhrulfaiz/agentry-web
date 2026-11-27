'use client'

import { Collapsible } from '@astryxdesign/core/Collapsible'
import { HStack } from '@astryxdesign/core/HStack'
import { Spinner } from '@astryxdesign/core/Spinner'
import { Text } from '@astryxdesign/core/Text'
import { VStack } from '@astryxdesign/core/VStack'
import { useEffect, useState, type ReactNode } from 'react'
import type { MessageView } from '@/chat/reducer'
import { browserToolTitle } from '@/chat/browser-tools'
import type { ChatEntry } from './group-turns'
import { formatDuration } from './group-turns'
import { summarizeArgs } from './ToolCard'

type Group = Extract<ChatEntry, { type: 'group' }>

/** The summary says what the turn did: "Worked for 48s · 6 commands · 3 files edited · 2 subagents"; a turn that only reasoned reads "Thought for 12s". */
export function groupLabel(g: Pick<Group, 'thinking' | 'commands' | 'edits' | 'subagents' | 'tools' | 'steps' | 'seconds'>): string {
  const plural = (n: number, one: string, many = `${one}s`) => `${String(n)} ${n === 1 ? one : many}`
  const time = g.seconds === undefined ? '' : ` for ${formatDuration(g.seconds)}`
  const parts = [
    g.commands > 0 && plural(g.commands, 'command'),
    g.edits > 0 && `${plural(g.edits, 'file')} edited`,
    g.subagents > 0 && plural(g.subagents, 'subagent'),
    g.tools > 0 && plural(g.tools, 'tool'),
  ].filter((p): p is string => typeof p === 'string')
  if (parts.length === 0) return `Thought${time}`
  return [`Worked${time}`, ...parts].join(' · ')
}

/** What a running turn is doing right now, in a few words: "Thinking…", "command pnpm test", "Subagent: research". */
export function currentStepLabel(view: MessageView | undefined): string {
  if (!view) return 'Working…'
  if (view.kind === 'reasoning') return view.streaming ? 'Thinking…' : 'Thought'
  if (view.kind === 'subagent') return `Subagent: ${view.name}`
  if (view.kind === 'tool') {
    const title = browserToolTitle(view.name, view.args)
    if (title) return title
    const args = summarizeArgs(view.args)
    return args ? `${view.name} ${args}` : view.name
  }
  return 'Working…'
}

/** "command pnpm test · 4 steps · 12s" for a running group; `now` is epoch seconds. */
export function runningLabel(group: Pick<Group, 'current' | 'steps' | 'startedAt'>, now: number): string {
  const parts = [currentStepLabel(group.current)]
  if (group.steps > 1) parts.push(`${String(group.steps)} steps`)
  if (group.startedAt !== undefined && now >= group.startedAt) parts.push(formatDuration(now - group.startedAt))
  return parts.join(' · ')
}

/** Epoch seconds, ticking once a second while `active`. */
function useNow(active: boolean): number {
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000))
  useEffect(() => {
    if (!active) return
    const timer = setInterval(() => { setNow(Math.floor(Date.now() / 1000)) }, 1000)
    return () => { clearInterval(timer) }
  }, [active])
  return now
}

/**
 * A turn's process rows behind one summary row; `children` is the full timeline. A finished turn reads
 * "Worked for 48s · …"; a running one shows a spinner and what it is doing now, with a live timer.
 */
export function TurnGroup({ group, open, onOpenChange, children }: { group: Group; open: boolean; onOpenChange(open: boolean): void; children: ReactNode }) {
  const now = useNow(group.running === true)
  return (
    <Collapsible
      isOpen={open}
      onOpenChange={onOpenChange}
      chevronPosition="start"
      data-testid="turn-group"
      data-running={group.running ? '' : undefined}
      trigger={
        group.running ? (
          <HStack gap={2} vAlign="center">
            <Spinner size="sm" />
            <Text type="supporting" weight="medium" maxLines={1}>
              {runningLabel(group, now)}
            </Text>
          </HStack>
        ) : (
          <Text type="supporting" weight="medium" textWrap="nowrap">
            {groupLabel(group)}
          </Text>
        )
      }
    >
      <VStack gap={2}>{children}</VStack>
    </Collapsible>
  )
}
