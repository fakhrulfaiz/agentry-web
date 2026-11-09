'use client'

import { Collapsible } from '@astryxdesign/core/Collapsible'
import { Text } from '@astryxdesign/core/Text'
import * as stylex from '@stylexjs/stylex'

const styles = stylex.create({ prose: { whiteSpace: 'pre-wrap' } })

/** The model's reasoning summary, collapsed under "Thinking". */
export function ReasoningBlock({ text }: { text: string }) {
  return (
    <Collapsible trigger={<Text type="supporting">Thinking</Text>} defaultIsOpen={false} chevronPosition="start">
      <Text type="supporting" as="p" xstyle={styles.prose}>
        {text}
      </Text>
    </Collapsible>
  )
}
