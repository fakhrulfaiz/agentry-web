'use client'

/**
 * The selected record's details: kind, name and status, then Token usage,
 * Duration, Input, Output, Thinking and Timing. What Agentry did not record
 * says so ("Not recorded", "Not available"); nothing is estimated.
 */
import { Button } from '@astryxdesign/core/Button'
import { Heading } from '@astryxdesign/core/Heading'
import { HStack } from '@astryxdesign/core/HStack'
import { StackItem } from '@astryxdesign/core/Layout'
import { Text } from '@astryxdesign/core/Text'
import { Token } from '@astryxdesign/core/Token'
import { VStack } from '@astryxdesign/core/VStack'
import type { ReactNode } from 'react'
import type { OAITokenUsage } from '@/api/types'
import { Markdown } from '@/ui/chat/Markdown'
import type { TrajectoryRecord } from './build-trajectory'
import { formatClock, formatSeconds, formatTokens, NOT_AVAILABLE, NOT_RECORDED } from './format'
import { JsonView } from './JsonView'
import { KindChip } from './KindChip'
import { recordName, STATUS } from './labels'

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <VStack gap={1} as="section" aria-label={title}>
      <Heading level={3}>{title}</Heading>
      {children}
    </VStack>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <HStack gap={2}>
      <StackItem size="fill">
        <Text type="supporting">{label}</Text>
      </StackItem>
      <Text hasTabularNumbers>{value}</Text>
    </HStack>
  )
}

function Usage({ usage }: { usage?: OAITokenUsage }) {
  if (!usage) return <Text type="supporting">Usage not reported</Text>
  return (
    <VStack gap={0.5}>
      <Row label="Input" value={formatTokens(usage.input_tokens)} />
      <Row label="Cached" value={formatTokens(usage.input_tokens_details.cached_tokens)} />
      <Row label="Output" value={formatTokens(usage.output_tokens)} />
      <Row label="Reasoning" value={formatTokens(usage.output_tokens_details.reasoning_tokens)} />
      <Row label="Tokens" value={formatTokens(usage.total_tokens)} />
    </VStack>
  )
}

export function Inspector({ record, onShowInChat }: { record: TrajectoryRecord; onShowInChat(record: TrajectoryRecord): void }) {
  const status = STATUS[record.status]
  const duration = record.startedAt !== undefined && record.endedAt !== undefined ? formatSeconds(record.endedAt - record.startedAt) : null
  const kind = record.subKind ?? record.kind
  const hasInput = kind === 'tool' || kind === 'user'
  return (
    <VStack gap={4} data-testid="trajectory-inspector">
      <VStack gap={2}>
        <HStack gap={2} vAlign="center" wrap="wrap">
          <KindChip record={record} />
          <StackItem size="fill">
            <Text weight="semibold" maxLines={1}>
              {recordName(record)}
            </Text>
          </StackItem>
          <Token size="sm" label={status.label} color={status.color} />
        </HStack>
        <Button label="Show in chat" variant="secondary" size="sm" onClick={() => onShowInChat(record)} />
      </VStack>
      <Section title="Token usage">
        <Usage usage={record.usage} />
      </Section>
      <Section title="Duration">
        <Text>{duration ?? NOT_RECORDED}</Text>
      </Section>
      {hasInput && (
        <Section title="Input">
          {record.input === undefined ? <Text type="supporting">No content</Text> : <JsonView value={record.input} label="input" />}
        </Section>
      )}
      <Section title="Output">
        {record.output === undefined || record.output === '' ? (
          <Text type="supporting">{kind === 'assistant' ? 'Tool call only' : record.status === 'pending' ? 'Running…' : 'No output'}</Text>
        ) : kind === 'assistant' ? (
          <Markdown text={String(record.output)} />
        ) : (
          <JsonView value={record.output} label="output" />
        )}
      </Section>
      {record.thinking && (
        <Section title="Thinking">
          <Markdown text={record.thinking} />
        </Section>
      )}
      <Section title="Timing">
        <VStack gap={0.5}>
          <Row label="Started" value={record.startedAt !== undefined ? formatClock(record.startedAt) : NOT_RECORDED} />
          <Row label="Total duration" value={duration ?? NOT_RECORDED} />
          <Row label="TTFT" value={NOT_RECORDED} />
          <Row label="Generation" value={NOT_RECORDED} />
          <Row label="Throughput" value={NOT_AVAILABLE} />
        </VStack>
      </Section>
    </VStack>
  )
}
