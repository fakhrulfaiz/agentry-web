'use client'

/** A connected-app sign-in request from a tool call, as a Connect button instead of a raw link. */
import { Button } from '@astryxdesign/core/Button'
import { HStack } from '@astryxdesign/core/HStack'
import { Text } from '@astryxdesign/core/Text'
import { ArrowUpRightIcon } from '@heroicons/react/16/solid'
import type { ConnectRequest } from '@/api/types'

/** `gmail` → `Gmail`; unknown apps are "app". */
export const appLabel = (toolkit: string | null): string => (toolkit ? toolkit.charAt(0).toUpperCase() + toolkit.slice(1) : 'app')

export function ConnectCard({ request }: { request: ConnectRequest }) {
  return (
    <HStack gap={3} vAlign="center" paddingBlock={2}>
      <Button label={`Connect ${appLabel(request.toolkit)}`} variant="primary" size="sm" href={request.url} target="_blank" rel="noopener noreferrer" endContent={<ArrowUpRightIcon width={16} height={16} aria-hidden />} />
      <Text type="supporting" color="secondary">Sign in opens in a new tab. Come back here when you are done.</Text>
    </HStack>
  )
}
