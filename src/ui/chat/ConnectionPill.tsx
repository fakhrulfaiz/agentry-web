'use client'

import { HStack } from '@astryxdesign/core/HStack'
import { Spinner } from '@astryxdesign/core/Spinner'
import { Text } from '@astryxdesign/core/Text'
import type { Connection } from '@/chat/use-conversation'

/** "Reconnecting…" while the stream is down; nothing while it is live. */
export function ConnectionPill({ connection }: { connection: Connection }) {
  if (connection === 'live') return null
  const reconnecting = connection === 'reconnecting'
  return (
    <HStack gap={1} vAlign="center" role="status" aria-live="polite">
      {reconnecting && <Spinner size="sm" aria-label="" />}
      <Text type="supporting">{reconnecting ? 'Reconnecting…' : 'Disconnected'}</Text>
    </HStack>
  )
}
