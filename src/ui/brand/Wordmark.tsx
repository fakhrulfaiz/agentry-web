'use client'

import { HStack } from '@astryxdesign/core/HStack'
import { Icon } from '@astryxdesign/core/Icon'
import { Text } from '@astryxdesign/core/Text'
import type { SVGProps } from 'react'

/** The Agentry mark: an open "A" over a baseline node. Drawn in `currentColor`; size and color come from `Icon`. */
export function AgentryMark(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}>
      <path d="M4 20 12 4l8 16" />
      <path d="M7.5 13h9" />
      <circle cx="12" cy="20" r="1.5" fill="currentColor" stroke="none" />
    </svg>
  )
}

/** Mark plus product name. */
export function Wordmark({ size = 'md' }: { size?: 'md' | 'lg' }) {
  return (
    <HStack gap={2} vAlign="center">
      <Icon icon={AgentryMark} color="accent" size={size === 'lg' ? 'lg' : 'md'} />
      <Text type={size === 'lg' ? 'display-3' : 'label'} weight="semibold">
        Agentry
      </Text>
    </HStack>
  )
}
