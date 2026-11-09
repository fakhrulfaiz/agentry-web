'use client'

/**
 * A recorded value: complete JSON objects and arrays as a tree (every
 * container open, each one collapsible), with a `{}` toggle for the raw JSON
 * and a copy button; anything else as preserved text.
 */
import { Button } from '@astryxdesign/core/Button'
import { CodeBlock } from '@astryxdesign/core/CodeBlock'
import { Collapsible } from '@astryxdesign/core/Collapsible'
import { HStack } from '@astryxdesign/core/HStack'
import { StackItem } from '@astryxdesign/core/Layout'
import { Text } from '@astryxdesign/core/Text'
import { VStack } from '@astryxdesign/core/VStack'
import * as stylex from '@stylexjs/stylex'
import { spacingVars } from '@astryxdesign/core/theme/tokens.stylex'
import { useState } from 'react'

const styles = stylex.create({
  nested: { paddingInlineStart: spacingVars['--spacing-4'] },
  value: { overflowWrap: 'anywhere', minInlineSize: 0 },
})

/** The value as a JSON container, when it is one (a string holding one counts). */
export function jsonContainer(value: unknown): object | null {
  let v = value
  if (typeof v === 'string') {
    const trimmed = v.trim()
    if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) return null
    try {
      v = JSON.parse(trimmed) as unknown
    } catch {
      return null
    }
  }
  return v !== null && typeof v === 'object' ? (v as object) : null
}

function rawText(value: unknown): string {
  return typeof value === 'string' ? value : (JSON.stringify(value, null, 2) ?? String(value))
}

function Leaf({ name, value }: { name: string; value: unknown }) {
  const shown = typeof value === 'string' ? JSON.stringify(value) : String(value)
  return (
    <HStack gap={1}>
      <Text type="code" color="secondary">
        {name}:
      </Text>
      <StackItem size="fill" xstyle={styles.value}>
        <Text type="code">{shown}</Text>
      </StackItem>
    </HStack>
  )
}

function Node({ name, value }: { name: string; value: object }) {
  const entries = Array.isArray(value) ? value.map((v, i) => [String(i), v] as const) : Object.entries(value)
  const summary = Array.isArray(value) ? `[${value.length}]` : `{${entries.length}}`
  return (
    <Collapsible
      chevronPosition="start"
      trigger={
        <Text type="code">
          {name} {summary}
        </Text>
      }
    >
      <VStack gap={0.5} xstyle={styles.nested}>
        {entries.map(([k, v]) => (v !== null && typeof v === 'object' ? <Node key={k} name={k} value={v} /> : <Leaf key={k} name={k} value={v} />))}
      </VStack>
    </Collapsible>
  )
}

export function JsonView({ value, label, language = 'plaintext' }: { value: unknown; label: string; language?: string }) {
  const tree = jsonContainer(value)
  const [raw, setRaw] = useState(false)
  if (!tree) return <CodeBlock code={rawText(value)} language={language} width="100%" maxHeight={360} isWrapped />
  const text = typeof value === 'string' ? value : JSON.stringify(value, null, 2)
  return (
    <VStack gap={1}>
      <HStack gap={1} hAlign="end">
        <Button label={raw ? `Show ${label} as a tree` : `Show ${label} as raw JSON`} variant="ghost" size="sm" aria-pressed={raw} onClick={() => setRaw((r) => !r)}>
          {'{}'}
        </Button>
        <Button label={`Copy ${label}`} variant="ghost" size="sm" onClick={() => void navigator.clipboard?.writeText(text)} />
      </HStack>
      {raw ? (
        <CodeBlock code={text} language="json" width="100%" maxHeight={360} isWrapped />
      ) : (
        <VStack gap={0.5} data-testid="json-tree">
          {Array.isArray(tree)
            ? tree.map((v, i) => (v !== null && typeof v === 'object' ? <Node key={i} name={String(i)} value={v as object} /> : <Leaf key={i} name={String(i)} value={v} />))
            : Object.entries(tree).map(([k, v]) => (v !== null && typeof v === 'object' ? <Node key={k} name={k} value={v as object} /> : <Leaf key={k} name={k} value={v} />))}
        </VStack>
      )}
    </VStack>
  )
}
