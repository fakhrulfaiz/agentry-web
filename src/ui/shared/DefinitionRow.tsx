'use client'

/** One row of a definition list: a small label with its value beside it, or under it for long values. */
import { HStack } from '@astryxdesign/core/HStack'
import { Text } from '@astryxdesign/core/Text'
import { VStack } from '@astryxdesign/core/VStack'
import * as stylex from '@stylexjs/stylex'
import type { ReactNode } from 'react'

const styles = stylex.create({ value: { flex: 1, minWidth: 0, textAlign: 'end' } })

export function DefinitionRow({ label, stacked = false, children }: { label: string; stacked?: boolean; children: ReactNode }) {
  return (
    <VStack gap={1}>
      <HStack gap={3} vAlign="start">
        <Text type="supporting" color="secondary">{label}</Text>
        {!stacked && <div {...stylex.props(styles.value)}><Text type="supporting" color="primary">{children}</Text></div>}
      </HStack>
      {stacked && children}
    </VStack>
  )
}
