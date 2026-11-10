'use client'

import { Collapsible } from '@astryxdesign/core/Collapsible'
import { Text } from '@astryxdesign/core/Text'
import { VStack } from '@astryxdesign/core/VStack'
import type { ReactNode } from 'react'
import type { ChatEntry } from './group-turns'
import { formatDuration } from './group-turns'

type Group = Extract<ChatEntry, { type: 'group' }>

/** The summary text: "Thought for 2m · 14 steps", or "Used 6 tools" without thinking. */
export function groupLabel(g: Pick<Group, 'thinking' | 'tools' | 'steps' | 'seconds'>): string {
  const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`
  if (!g.thinking) return `Used ${plural(g.tools, 'tool')}`
  return [g.seconds === undefined ? 'Thought' : `Thought for ${formatDuration(g.seconds)}`, plural(g.steps, 'step')].join(' · ')
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
