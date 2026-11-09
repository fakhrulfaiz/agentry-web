'use client'

/**
 * The trajectory ledger: per turn, a sticky "Turn N" header with its Input,
 * Output, Think and Time, then its records (User, Assistant step, Tool, and a
 * call's subagent activity as Subtool rows). Tool calls fold under their step
 * ("N tool calls"); subcalls fold under their call ("N subcalls"), folded by
 * default. Selecting a row opens the inspector.
 */
import { Button } from '@astryxdesign/core/Button'
import { HStack } from '@astryxdesign/core/HStack'
import { Icon } from '@astryxdesign/core/Icon'
import { StackItem } from '@astryxdesign/core/Layout'
import { Spinner } from '@astryxdesign/core/Spinner'
import { List, ListItem } from '@astryxdesign/core/List'
import { Text } from '@astryxdesign/core/Text'
import { Token } from '@astryxdesign/core/Token'
import { VStack } from '@astryxdesign/core/VStack'
import { colorVars, spacingVars } from '@astryxdesign/core/theme/tokens.stylex'
import { ChevronDownIcon, ChevronRightIcon } from '@heroicons/react/20/solid'
import * as stylex from '@stylexjs/stylex'
import type { OAITokenUsage } from '@/api/types'
import type { TrajectoryRecord, TrajectoryTurn } from './build-trajectory'
import { EMPTY, formatSeconds, formatTokens } from './format'
import { KindChip } from './KindChip'
import { recordName, STATUS, SUB_LABEL } from './labels'

const styles = stylex.create({
  header: {
    position: 'sticky',
    insetBlockStart: 0,
    zIndex: 1,
    backgroundColor: colorVars['--color-background-surface'],
    borderBlockEndWidth: 1,
    borderBlockEndStyle: 'solid',
    borderBlockEndColor: colorVars['--color-neutral'],
  },
  metric: { minInlineSize: spacingVars['--spacing-12'] },
  nested: { paddingInlineStart: spacingVars['--spacing-6'] },
  muted: { opacity: 0.6 },
  // The kind chip column: fixed and narrow, chips right-aligned before the preview.
  chip: { inlineSize: `calc(${spacingVars['--spacing-12']} * 2)`, flexShrink: 0 },
  // Previews share the row and ellipsize on one line.
  preview: { minInlineSize: 0, flexShrink: 1 },
  name: { flexShrink: 0, maxInlineSize: '40%' },
})

export interface Folds {
  /** Turns whose rows are hidden. */
  turns: ReadonlySet<string>
  /** Assistant steps whose tool calls are folded into a summary. */
  calls: ReadonlySet<string>
  /** Calls whose subcalls are shown (folded by default). */
  subcalls: ReadonlySet<string>
}

export interface LedgerProps {
  turns: TrajectoryTurn[]
  between: TrajectoryRecord[]
  folds: Folds
  onToggle(kind: keyof Folds, id: string): void
  /** Records to show; `null` shows all. Ancestors of a shown subcall show too. */
  visible: ReadonlySet<string> | null
  selectedId: string | null
  onSelect(record: TrajectoryRecord): void
  now: number
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <HStack gap={1} vAlign="center" hAlign="end" xstyle={styles.metric}>
      <Text type="supporting" size="xsm">
        {label}
      </Text>
      <Text size="xsm" hasTabularNumbers>
        {value}
      </Text>
    </HStack>
  )
}

/** A one-line preview of a tool's result. */
function resultPreview(r: TrajectoryRecord): string | undefined {
  if (r.output === undefined || r.output === '') return undefined
  const text = typeof r.output === 'string' ? r.output : JSON.stringify(r.output)
  return text.replace(/\s+/g, ' ').slice(0, 200)
}

function usageCells(usage: OAITokenUsage | undefined) {
  return {
    input: usage ? formatTokens(usage.input_tokens) : EMPTY,
    output: usage ? formatTokens(usage.output_tokens) : EMPTY,
    think: usage ? formatTokens(usage.output_tokens_details.reasoning_tokens) : EMPTY,
  }
}

function description(r: TrajectoryRecord): string | undefined {
  const kind = r.subKind ?? r.kind
  const prefix = r.kind === 'subtool' ? `${SUB_LABEL[r.subKind ?? 'tool']} · ` : ''
  if (kind === 'tool') return r.title ? `${prefix}${r.title}` : prefix || undefined
  if (kind === 'assistant') return `${prefix}${r.model ? `Step ${r.step} · ${r.model}` : `Step ${r.step}`}`
  return prefix ? prefix.slice(0, -3) : undefined
}

function Row({ record, selected, onSelect, muted }: { record: TrajectoryRecord; selected: boolean; onSelect(): void; muted?: boolean }) {
  const status = STATUS[record.status]
  const isTool = (record.subKind ?? record.kind) === 'tool'
  // A tool row leads with its recorded name, then the argument summary and its result.
  const name = isTool ? recordName(record) : record.title || recordName(record)
  const detail = description(record)
  const result = isTool ? resultPreview(record) : undefined
  const time = record.startedAt !== undefined && record.endedAt !== undefined ? formatSeconds(record.endedAt - record.startedAt) : ''
  return (
    <ListItem
      label={
        <HStack gap={2} vAlign="center">
          <Text type={isTool ? 'code' : 'body'} size="sm" maxLines={1} xstyle={isTool ? styles.name : styles.preview}>
            {name}
          </Text>
          {detail && (
            <Text type={isTool ? 'code' : 'supporting'} size="sm" color="secondary" maxLines={1} xstyle={styles.preview}>
              {detail}
            </Text>
          )}
          {result && (
            <Text type="code" size="sm" color="secondary" maxLines={1} xstyle={styles.preview}>
              {`→ ${result}`}
            </Text>
          )}
        </HStack>
      }
      startContent={
        <HStack hAlign="end" vAlign="center" xstyle={styles.chip}>
          <KindChip record={record} />
        </HStack>
      }
      endContent={
        <HStack gap={2} vAlign="center">
          {time && (
            <Text type="supporting" size="xsm" hasTabularNumbers>
              {time}
            </Text>
          )}
          {record.status === 'pending' && <Spinner size="sm" aria-label="Pending" />}
          {record.status !== 'completed' && <Token size="sm" label={status.label} color={status.color} />}
        </HStack>
      }
      isSelected={selected}
      onClick={onSelect}
      data-testid="trajectory-row"
      data-record-id={record.id}
      xstyle={muted ? styles.muted : undefined}
    />
  )
}

function Summary({ label, onExpand, testId }: { label: string; onExpand(): void; testId: string }) {
  return (
    <ListItem
      label={
        <Text type="supporting" size="sm">
          {label}
        </Text>
      }
      startContent={
        <HStack hAlign="end" vAlign="center" xstyle={styles.chip}>
          <Icon icon={ChevronRightIcon} size="sm" color="secondary" />
        </HStack>
      }
      onClick={onExpand}
      data-testid={testId}
    />
  )
}

function Records({ records, props }: { records: TrajectoryRecord[]; props: LedgerProps }) {
  const { folds, onToggle, visible, selectedId, onSelect } = props
  const shown = (r: TrajectoryRecord): boolean => visible === null || visible.has(r.id) || (r.subcalls?.some(shown) ?? false)
  const out: React.ReactNode[] = []
  for (const r of records) {
    if (!shown(r)) continue
    const searching = visible !== null
    if (r.kind === 'tool' && r.stepId && folds.calls.has(r.stepId) && !searching) continue
    out.push(<Row key={r.id} record={r} selected={selectedId === r.id} onSelect={() => onSelect(r)} />)
    if (r.kind === 'assistant' && folds.calls.has(r.id) && !searching) {
      const n = records.filter((t) => t.stepId === r.id).length
      if (n > 0) out.push(<Summary key={`${r.id}:calls`} label={n === 1 ? '1 tool call' : `${n} tool calls`} onExpand={() => onToggle('calls', r.id)} testId="trajectory-calls-summary" />)
    }
    if (r.subcalls && r.subcalls.length > 0) {
      const children = r.subcalls.filter(shown)
      if (folds.subcalls.has(r.id) || (searching && children.length > 0)) {
        out.push(
          <VStack key={`${r.id}:sub`} xstyle={styles.nested} as="li">
            <List density="compact" hasDividers>
              {children.map((c) => (
                <Row key={c.id} record={c} selected={selectedId === c.id} onSelect={() => onSelect(c)} />
              ))}
            </List>
          </VStack>,
        )
      } else {
        const n = r.subcalls.length
        out.push(<Summary key={`${r.id}:subcalls`} label={n === 1 ? '1 subcall' : `${n} subcalls`} onExpand={() => onToggle('subcalls', r.id)} testId="trajectory-subcalls-summary" />)
      }
    }
  }
  return out.length > 0 ? <List density="compact" hasDividers>{out}</List> : null
}

function TurnSection({ turn, props }: { turn: TrajectoryTurn; props: LedgerProps }) {
  const open = !props.folds.turns.has(turn.id)
  const cells = usageCells(turn.usage)
  const end = turn.endedAt ?? (turn.status === 'in_progress' || turn.status === 'queued' || turn.status === 'waiting' ? props.now : undefined)
  const time = end !== undefined ? formatSeconds(end - turn.startedAt) : EMPTY
  const status = turn.status === 'failed' ? STATUS.failed : turn.status === 'completed' || turn.status === 'cancelled' ? STATUS.completed : STATUS.pending
  if (props.visible !== null && !turn.records.some((r) => props.visible?.has(r.id) || r.subcalls?.some((c) => props.visible?.has(c.id)))) return null
  return (
    <VStack as="section" aria-label={`Turn ${turn.index}`} data-testid="trajectory-turn">
      <HStack gap={3} vAlign="center" paddingBlock={0.5} paddingInline={1} xstyle={styles.header}>
        <StackItem size="fill">
          <HStack gap={2} vAlign="center">
            <Button
              label={`Turn ${turn.index}`}
              variant="ghost"
              size="sm"
              icon={<Icon icon={open ? ChevronDownIcon : ChevronRightIcon} />}
              aria-expanded={open}
              onClick={() => props.onToggle('turns', turn.id)}
            />
            <Token size="sm" label={status.label} color={status.color} />
          </HStack>
        </StackItem>
        <Metric label="Input" value={cells.input} />
        <Metric label="Output" value={cells.output} />
        <Metric label="Think" value={cells.think} />
        <Metric label="Time" value={time} />
      </HStack>
      {open && <Records records={turn.records} props={props} />}
    </VStack>
  )
}

export function Ledger(props: LedgerProps) {
  const between = props.between
  return (
    <VStack>
      {props.turns.map((turn) => (
        <TurnSection key={turn.id} turn={turn} props={props} />
      ))}
      {between.length > 0 && (
        <VStack as="section" aria-label="Between turns">
          <HStack paddingBlock={1} paddingInline={2} xstyle={styles.header}>
            <Text type="supporting" size="xsm" weight="semibold">
              Between turns
            </Text>
          </HStack>
          <Records records={between} props={props} />
        </VStack>
      )}
    </VStack>
  )
}
