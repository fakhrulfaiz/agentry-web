'use client'

import { Card } from '@astryxdesign/core/Card'
import { HStack } from '@astryxdesign/core/HStack'
import { Icon } from '@astryxdesign/core/Icon'
import { StackItem } from '@astryxdesign/core/Layout'
import { Spinner } from '@astryxdesign/core/Spinner'
import { Text } from '@astryxdesign/core/Text'
import { Token } from '@astryxdesign/core/Token'
import { UserGroupIcon } from '@heroicons/react/24/outline'
import type { MessageView } from '@/chat/reducer'

type SubagentView = Extract<MessageView, { kind: 'subagent' }>

const LABEL: Record<string, string> = {
  queued: 'Queued',
  in_progress: 'Working',
  completed: 'Done',
  failed: 'Failed',
  cancelled: 'Cancelled',
}
const COLOR = { completed: 'green', failed: 'red', cancelled: 'gray' } as const

/** "Delegated to <name>" with the delegated turn's status. */
export function SubagentCard({ view }: { view: SubagentView }) {
  const running = view.status === 'in_progress' || view.status === 'queued'
  return (
    <Card padding={3} width="100%">
      <HStack gap={2} vAlign="center">
        <Icon icon={UserGroupIcon} color="secondary" size="sm" />
        <StackItem size="fill">
          <Text>Delegated to {view.name}</Text>
        </StackItem>
        {running && <Spinner size="sm" aria-label="Working" />}
        <Token size="sm" label={LABEL[view.status] ?? view.status} color={COLOR[view.status as keyof typeof COLOR] ?? 'default'} />
      </HStack>
    </Card>
  )
}
