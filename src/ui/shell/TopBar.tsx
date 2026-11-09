import { HStack } from '@astryxdesign/core/HStack'
import { Heading } from '@astryxdesign/core/Heading'
import { StackItem } from '@astryxdesign/core/Layout'
import type { ReactNode } from 'react'

/** The bar above a page's content: the page or session title, then page controls (e.g. the model picker). */
export function TopBar({ title, end }: { title: string; end?: ReactNode }) {
  return (
    <HStack as="header" gap={3} vAlign="center" paddingInline={4} paddingBlock={2}>
      <StackItem size="fill">
        <Heading level={1} maxLines={1} weight="medium">
          {title}
        </Heading>
      </StackItem>
      {end}
    </HStack>
  )
}
