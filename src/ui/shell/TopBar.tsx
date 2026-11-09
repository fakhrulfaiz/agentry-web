import { Heading } from '@astryxdesign/core/Heading'
import { HStack } from '@astryxdesign/core/HStack'
import { StackItem } from '@astryxdesign/core/Layout'
import { VStack } from '@astryxdesign/core/VStack'
import type { ReactNode } from 'react'

/**
 * The bar above a page's content. Row 1: the title, then page controls. A
 * string title is a page heading (Settings); a chat passes its title menu
 * button; a blank chat passes none, so the row keeps only its controls.
 * Row 2, when given: the view tabs, aligned with the title.
 */
export function TopBar({ title, end, tabs }: { title?: ReactNode; end?: ReactNode; tabs?: ReactNode }) {
  return (
    <VStack as="header" paddingInline={4} paddingBlockStart={2} paddingBlockEnd={tabs ? 0 : 2} gap={1}>
      <HStack gap={3} vAlign="center">
        <StackItem size="fill">
          {typeof title === 'string' ? (
            <Heading level={1} maxLines={1} weight="medium">
              {title}
            </Heading>
          ) : (
            title
          )}
        </StackItem>
        {end}
      </HStack>
      {tabs}
    </VStack>
  )
}
