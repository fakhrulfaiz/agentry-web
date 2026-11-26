'use client'

import { Collapsible } from '@astryxdesign/core/Collapsible'
import { Text } from '@astryxdesign/core/Text'
import { VStack } from '@astryxdesign/core/VStack'
import type { ReactNode } from 'react'
import type { ChatEntry } from './group-turns'
import { formatDuration } from './group-turns'

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

/** A finished turn's process rows behind one collapsed summary row; `children` is the full timeline. */
export function TurnGroup({ group, open, onOpenChange, children }: { group: Group; open: boolean; onOpenChange(open: boolean): void; children: ReactNode }) {
  return (
    <Collapsible
      isOpen={open}
      onOpenChange={onOpenChange}
      chevronPosition="start"
      data-testid="turn-group"
      trigger={
        <Text type="supporting" weight="medium" textWrap="nowrap">
          {groupLabel(group)}
        </Text>
      }
    >
      <VStack gap={2}>{children}</VStack>
    </Collapsible>
  )
}
