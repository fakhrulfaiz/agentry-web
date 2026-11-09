import { Heading } from '@astryxdesign/core/Heading'
import { HStack } from '@astryxdesign/core/HStack'
import { StackItem } from '@astryxdesign/core/Layout'
import { VStack } from '@astryxdesign/core/VStack'
import type { ReactNode } from 'react'

/**
 * The bar above a page's content. Row 1: the page or session title (its own
 * seat, so it can become a menu button), then page controls. Row 2, when
 * given: the view tabs, aligned with the title.
 */
export function TopBar({ title, end, tabs }: { title: string; end?: ReactNode; tabs?: ReactNode }) {
  return (
    <VStack as="header" paddingInline={4} paddingBlockStart={2} paddingBlockEnd={tabs ? 0 : 2} gap={1}>
      <HStack gap={3} vAlign="center">
        <StackItem size="fill">
          <Heading level={1} maxLines={1} weight="medium">
            {title}
          </Heading>
        </StackItem>
        {end}
      </HStack>
      {tabs}
    </VStack>
  )
}
