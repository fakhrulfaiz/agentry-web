'use client'

import { Collapsible } from '@astryxdesign/core/Collapsible'
import { HStack } from '@astryxdesign/core/HStack'
import { StackItem } from '@astryxdesign/core/Layout'
import { Text } from '@astryxdesign/core/Text'
import * as stylex from '@stylexjs/stylex'
import { useState } from 'react'
import './shimmer.css'

const styles = stylex.create({
  prose: { whiteSpace: 'pre-wrap' },
  // The trigger's label slot is never squeezed below its content's width, so the
  // header reports no intrinsic width of its own and takes the column's instead.
  header: { contain: 'inline-size', minInlineSize: 0 },
  label: { flexShrink: 0, whiteSpace: 'nowrap' },
  summary: { minInlineSize: 0, overflow: 'hidden' },
})

/** The first line of the reasoning, for the collapsed trigger. */
export function reasoningSummary(text: string): string {
  return text.trim().split(/\n/)[0]?.trim() ?? ''
}

/**
 * The model's reasoning under "Thinking". Open while it streams (its turn is
 * running); when it finishes it collapses to one line ("Thought" and the
 * first line of the reasoning, cut to one line with an ellipsis inside the
 * column). The label never wraps. The user can toggle it either way.
 */
export function ReasoningBlock({ text, streaming }: { text: string; streaming: boolean }) {
  const [open, setOpen] = useState(streaming)
  const [wasStreaming, setWasStreaming] = useState(streaming)
  if (streaming !== wasStreaming) {
    // Follow the stream: open when it starts, collapse when it ends.
    setWasStreaming(streaming)
    setOpen(streaming)
  }
  const summary = reasoningSummary(text)
  return (
    <Collapsible
      isOpen={open}
      onOpenChange={setOpen}
      chevronPosition="start"
      data-testid="reasoning"
      trigger={
        <HStack gap={2} vAlign="center" xstyle={styles.header} data-testid="reasoning-header">
          <StackItem xstyle={styles.label}>
            <span data-shimmer={streaming ? 'text' : undefined}>
              <Text type="supporting" weight="medium" textWrap="nowrap">
                {streaming ? 'Thinking…' : 'Thought'}
              </Text>
            </span>
          </StackItem>
          {!open && summary && (
            <StackItem size="fill" xstyle={styles.summary}>
              <Text type="supporting" maxLines={1} hasTruncateTooltip={false}>
                {summary}
              </Text>
            </StackItem>
          )}
        </HStack>
      }
    >
      <Text type="supporting" as="p" xstyle={styles.prose}>
        {text}
      </Text>
    </Collapsible>
  )
}
