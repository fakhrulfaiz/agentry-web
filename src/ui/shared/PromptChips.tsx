'use client'

/**
 * A wrapping row of small suggestion chips (starter prompts); picking one hands its text back. A prompt
 * ending in a space is a sentence for the user to finish and shows with a trailing "…".
 */
import { HStack } from '@astryxdesign/core/HStack'
import { Token } from '@astryxdesign/core/Token'

export function PromptChips({ prompts, onPick, label }: {
  prompts: readonly string[]
  onPick(text: string): void
  /** Accessible name of the group, such as "Starter prompts". */
  label: string
}) {
  return (
    <HStack gap={1} wrap="wrap" role="group" aria-label={label}>
      {prompts.map((text) => (
        <Token key={text} label={text.endsWith(' ') ? `${text.trimEnd()}…` : text} size="sm" onClick={() => onPick(text)} />
      ))}
    </HStack>
  )
}
