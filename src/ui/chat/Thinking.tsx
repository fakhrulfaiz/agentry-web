'use client'

/**
 * The row that says Agentry is working while nothing of the reply is visible
 * yet: the history is still loading, the message is being queued, or the model
 * is thinking before its first text (or reasoning / tool) arrives.
 */
import { ChatMessage, ChatMessageBubble } from '@astryxdesign/core/Chat'
import { HStack } from '@astryxdesign/core/HStack'
import { Spinner } from '@astryxdesign/core/Spinner'
import { Text } from '@astryxdesign/core/Text'

export function Thinking({ label }: { label: string }) {
  return (
    <ChatMessage sender="assistant" name="" data-testid="thinking">
      <ChatMessageBubble variant="ghost" width="100%">
        <HStack gap={2} vAlign="center">
          <Spinner size="sm" shade="subtle" aria-hidden="true" />
          <Text type="supporting">{label}</Text>
        </HStack>
      </ChatMessageBubble>
    </ChatMessage>
  )
}
