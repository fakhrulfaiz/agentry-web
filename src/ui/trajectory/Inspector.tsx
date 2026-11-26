'use client'

/**
 * The selected record's details: kind, name and status, then Token usage,
 * Duration, Input, Output, Thinking and Timing. What Agentry did not record
 * says so ("Not recorded", "Not available"); nothing is estimated.
 */
import { Button } from '@astryxdesign/core/Button'
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
    <VStack gap={0.5} as="section" aria-label={title}>
      <Text size="sm" weight="semibold">
        {title}
      </Text>
      {children}
    </VStack>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <HStack gap={2}>
      <StackItem size="fill">
        <Text type="supporting" size="sm">
          {label}
        </Text>
      </StackItem>
      <Text size="sm" hasTabularNumbers>
        {value}
      </Text>
    </HStack>
  )
}

function Usage({ usage }: { usage?: OAITokenUsage }) {
  if (!usage)
    return (
      <Text type="supporting" size="sm">
        Usage not reported
      </Text>
    )
  return (
    <VStack>
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
  // An assistant step: the wait for its first token, then generation; throughput needs recorded usage.
  const ttft = record.startedAt !== undefined && record.firstTokenAt !== undefined ? record.firstTokenAt - record.startedAt : null
  const generation = record.firstTokenAt !== undefined && record.endedAt !== undefined ? record.endedAt - record.firstTokenAt : null
  const throughput = generation !== null && generation > 0 && record.usage ? `${String(Math.round(record.usage.output_tokens / generation))} tok/s` : null
  const hasInput = kind === 'tool' || kind === 'user'
  return (
    <VStack gap={3} data-testid="trajectory-inspector">
      <VStack gap={1.5}>
        <HStack gap={2} vAlign="center" wrap="wrap">
          <KindChip record={record} />
          <StackItem size="fill">
            <Text type="code" size="sm" maxLines={1}>
              {recordName(record)}
            </Text>
          </StackItem>
          <Token size="sm" label={status.label} color={status.color} />
        </HStack>
        <Button label="Show in chat" variant="secondary" size="sm" onClick={() => onShowInChat(record)} />
      </VStack>
      {record.name === 'subagent' && (record.model !== undefined || record.prompt !== undefined) && (
        <Section title="Subagent">
          <VStack gap={2} data-testid="inspector-subagent">
            <Row label="Model" value={record.model ?? NOT_RECORDED} />
            {record.prompt !== undefined && <Text size="sm">{record.prompt}</Text>}
          </VStack>
        </Section>
      )}
      <Section title="Token usage">
        <Usage usage={record.usage} />
      </Section>
      <Section title="Duration">
        <Text size="sm" hasTabularNumbers>
          {duration ?? NOT_RECORDED}
        </Text>
      </Section>
      {hasInput && (
        <Section title="Input">
          {record.input === undefined ? (
            <Text type="supporting" size="sm">
              No content
            </Text>
          ) : (
            <JsonView value={record.input} label="input" />
          )}
        </Section>
      )}
      <Section title="Output">
        {record.output === undefined || record.output === '' ? (
          <Text type="supporting" size="sm">
            {kind === 'assistant' ? 'Tool call only' : record.status === 'pending' ? 'Running…' : 'No output'}
          </Text>
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
        <VStack>
          <Row label="Started" value={record.startedAt !== undefined ? formatClock(record.startedAt) : NOT_RECORDED} />
          <Row label="Total duration" value={duration ?? NOT_RECORDED} />
          <Row label="TTFT" value={ttft !== null ? formatSeconds(ttft) : NOT_RECORDED} />
          <Row label="Generation" value={generation !== null ? formatSeconds(generation) : NOT_RECORDED} />
          <Row label="Throughput" value={throughput ?? NOT_AVAILABLE} />
        </VStack>
      </Section>
    </VStack>
  )
}
