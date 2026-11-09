'use client'

import { ChatToolCalls } from '@astryxdesign/core/Chat'
import { CodeBlock } from '@astryxdesign/core/CodeBlock'
import { Text } from '@astryxdesign/core/Text'
import { VStack } from '@astryxdesign/core/VStack'
import type { MessageView } from '@/chat/reducer'

type ToolView = Extract<MessageView, { kind: 'tool' }>

const SUMMARY_MAX = 60
/** Longest output shown in the card; a fetched page can be far longer. */
export const OUTPUT_MAX = 20_000

/** Pretty JSON for objects; strings that hold JSON are parsed first. */
export function formatValue(value: unknown): string {
  if (typeof value === 'string') {
    try {
      return JSON.stringify(JSON.parse(value), null, 2)
    } catch {
      return value
    }
  }
  return JSON.stringify(value, null, 2) ?? String(value)
}

/** A one-line hint of the arguments: the first string value, else the first list of strings, else compact JSON; cut to 60 characters. */
export function summarizeArgs(args: unknown): string {
  let source: unknown = args
  if (typeof args === 'string') {
    try {
      source = JSON.parse(args)
    } catch {
      source = args
    }
  }
  let text: string
  if (source && typeof source === 'object' && !Array.isArray(source)) {
    const values = Object.values(source as Record<string, unknown>)
    const first = values.find((v) => typeof v === 'string')
    const list = values.find((v): v is string[] => Array.isArray(v) && v.length > 0 && v.every((x) => typeof x === 'string'))
    text = typeof first === 'string' ? first : list ? list.join(', ') : JSON.stringify(source)
  } else {
    text = typeof source === 'string' ? source : (JSON.stringify(source) ?? '')
  }
  text = text.replace(/\s+/g, ' ').trim()
  return text.length > SUMMARY_MAX ? `${text.slice(0, SUMMARY_MAX - 1)}…` : text
}

const STATUS = { running: 'running', done: 'complete', failed: 'error' } as const

/** A tool call: name, short argument summary and status; expands to the full input and output. */
export function ToolCard({ view }: { view: ToolView }) {
  const full = view.output === undefined ? null : formatValue(view.output)
  const output = full !== null && full.length > OUTPUT_MAX ? `${full.slice(0, OUTPUT_MAX)}\n… (${full.length - OUTPUT_MAX} more characters)` : full
  return (
    <ChatToolCalls
      calls={[
        {
          key: view.id,
          name: view.name,
          status: STATUS[view.status],
          target: summarizeArgs(view.args) || undefined,
          ...(view.status === 'failed' && output ? { errorMessage: output.slice(0, 200) } : {}),
          resultDetail: (
            <VStack gap={2}>
              <Text type="label">Input</Text>
              <CodeBlock code={formatValue(view.args)} language="json" width="100%" maxHeight={320} isWrapped />
              <Text type="label">Output</Text>
              {output === null ? (
                <Text type="supporting">{view.status === 'running' ? 'Running…' : 'No output'}</Text>
              ) : (
                <CodeBlock code={output} language="plaintext" width="100%" maxHeight={320} isWrapped />
              )}
            </VStack>
          ),
        },
      ]}
    />
  )
}
