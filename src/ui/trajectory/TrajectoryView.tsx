'use client'

/**
 * The Trajectory view of a chat: a toolbar (Duration, fold toggles for
 * Turns / Calls / Subcalls, Search), the timing overview, and the ledger.
 * The selected record's inspector opens in the right panel (a drawer on
 * narrow screens). The ledger stays at the tail as records arrive, until the
 * user scrolls up.
 */
import { HStack } from '@astryxdesign/core/HStack'
import { Icon } from '@astryxdesign/core/Icon'
import { StackItem } from '@astryxdesign/core/Layout'
import { ScrollableArea } from '@astryxdesign/core/ScrollableArea'
import { TextInput } from '@astryxdesign/core/TextInput'
import { ToggleButton } from '@astryxdesign/core/ToggleButton'
import { VStack } from '@astryxdesign/core/VStack'
import { ClockIcon, ListBulletIcon, MagnifyingGlassIcon, QueueListIcon, RectangleStackIcon } from '@heroicons/react/16/solid'
import { spacingVars } from '@astryxdesign/core/theme/tokens.stylex'
import * as stylex from '@stylexjs/stylex'
import { useEffect, useMemo, useRef, useState } from 'react'
import { SidePanelLayout } from '@/ui/shell/SidePanel'
import { allRecords, recordsInInterval, searchRecords, timelineSpans, type Trajectory, type TrajectoryRecord } from './build-trajectory'
import { Inspector } from './Inspector'
import { Ledger, type Folds } from './Ledger'
import { Overview, type Interval } from './Overview'

const styles = stylex.create({
  page: { flexGrow: 1, minBlockSize: 0, minInlineSize: 0 },
  ledger: { flexGrow: 1, minBlockSize: 0 },
})

const SEARCH_WIDTH = `calc(${spacingVars['--spacing-12']} * 4)`

/** Unix seconds, ticking every second while `live`. */
function useNow(live: boolean): number {
  const [now, setNow] = useState(() => Date.now() / 1000)
  useEffect(() => {
    if (!live) return
    setNow(Date.now() / 1000)
    const timer = setInterval(() => setNow(Date.now() / 1000), 1000)
    return () => clearInterval(timer)
  }, [live])
  return now
}

const intersect = (a: ReadonlySet<string> | null, b: ReadonlySet<string> | null): ReadonlySet<string> | null =>
  a === null ? b : b === null ? a : new Set([...a].filter((id) => b.has(id)))

export function TrajectoryView({
  trajectory,
  selectedId,
  onSelect,
  onShowInChat,
}: {
  trajectory: Trajectory
  selectedId: string | null
  onSelect(id: string | null): void
  onShowInChat(record: TrajectoryRecord): void
}) {
  const live = trajectory.turns.some((t) => t.endedAt === undefined && t.status !== 'failed' && t.status !== 'cancelled' && t.status !== 'completed')
  const now = useNow(live)
  const [actual, setActual] = useState(true)
  const [folds, setFolds] = useState<Folds>({ turns: new Set(), calls: new Set(), subcalls: new Set() })
  const [query, setQuery] = useState('')
  const [interval, setInterval_] = useState<Interval | null>(null)

  const records = useMemo(() => allRecords(trajectory), [trajectory])
  const selected = records.find((r) => r.id === selectedId) ?? null
  const spans = useMemo(() => timelineSpans(trajectory), [trajectory])
  const visible = useMemo(() => {
    const hits = query.trim() ? searchRecords(trajectory, query) : null
    const inRange = interval ? recordsInInterval(trajectory, interval.from, interval.to, now) : null
    return intersect(hits, inRange)
  }, [trajectory, query, interval, now])

  const toggle = (kind: keyof Folds, id: string) =>
    setFolds((f) => {
      const next = new Set(f[kind])
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return { ...f, [kind]: next }
    })
  const stepIds = trajectory.turns.flatMap((t) => t.records.filter((r) => r.kind === 'assistant' && t.records.some((x) => x.stepId === r.id)).map((r) => r.id))
  const callIds = records.filter((r) => r.subcalls && r.subcalls.length > 0).map((r) => r.id)
  const turnsFolded = trajectory.turns.length > 0 && trajectory.turns.every((t) => folds.turns.has(t.id))
  const callsFolded = stepIds.length > 0 && stepIds.every((id) => folds.calls.has(id))
  const subcallsFolded = callIds.every((id) => !folds.subcalls.has(id))

  // Follow the tail while the end of the ledger is in view.
  const tail = useRef<HTMLElement | null>(null)
  const following = useRef(true)
  useEffect(() => {
    const el = tail.current
    if (!el || typeof IntersectionObserver === 'undefined') return
    const observer = new IntersectionObserver(([entry]) => {
      following.current = entry.isIntersecting
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [])
  useEffect(() => {
    if (following.current) tail.current?.scrollIntoView?.({ block: 'end' })
  }, [records.length])

  return (
    <SidePanelLayout
      title="Event details"
      isOpen={selected !== null}
      onOpenChange={(open) => {
        if (!open) onSelect(null)
      }}
      panel={selected ? <Inspector record={selected} onShowInChat={onShowInChat} /> : null}
    >
      <VStack gap={2} paddingBlock={2} paddingInline={3} xstyle={styles.page} data-testid="trajectory-view">
        <HStack gap={1} vAlign="center" wrap="wrap" role="toolbar" aria-label="Trajectory toolbar">
          <ToggleButton
            label="Duration"
            icon={<Icon icon={ClockIcon} size="sm" />}
            size="sm"
            isPressed={actual}
            onPressedChange={setActual}
            tooltip={actual ? 'Use equal-width operations' : 'Use actual duration'}
          >
            Duration
          </ToggleButton>
          <ToggleButton
            label="Turns"
            icon={<Icon icon={RectangleStackIcon} size="sm" />}
            size="sm"
            isPressed={turnsFolded}
            onPressedChange={(fold) => setFolds((f) => ({ ...f, turns: new Set(fold ? trajectory.turns.map((t) => t.id) : []) }))}
            tooltip={turnsFolded ? 'Expand turns' : 'Collapse turns'}
          >
            Turns
          </ToggleButton>
          <ToggleButton
            label="Calls"
            icon={<Icon icon={QueueListIcon} size="sm" />}
            size="sm"
            isPressed={callsFolded}
            onPressedChange={(fold) => setFolds((f) => ({ ...f, calls: new Set(fold ? stepIds : []) }))}
            tooltip={callsFolded ? 'Expand calls' : 'Collapse calls'}
          >
            Calls
          </ToggleButton>
          <ToggleButton
            label="Subcalls"
            icon={<Icon icon={ListBulletIcon} size="sm" />}
            size="sm"
            isPressed={subcallsFolded}
            onPressedChange={(fold) => setFolds((f) => ({ ...f, subcalls: new Set(fold ? [] : callIds) }))}
            tooltip={subcallsFolded ? 'Expand subcalls' : 'Collapse subcalls'}
          >
            Subcalls
          </ToggleButton>
          <StackItem size="fill" />
          <TextInput
            label="Search trajectory"
            isLabelHidden
            placeholder="Search"
            size="sm"
            startIcon={MagnifyingGlassIcon}
            value={query}
            onChange={setQuery}
            width={SEARCH_WIDTH}
          />
        </HStack>
        <Overview spans={spans} now={now} actual={actual} interval={interval} onIntervalChange={setInterval_} />
        <ScrollableArea label="Trajectory ledger" xstyle={styles.ledger}>
          <Ledger
            turns={trajectory.turns}
            between={trajectory.between}
            folds={folds}
            onToggle={toggle}
            visible={visible}
            selectedId={selectedId}
            onSelect={(r) => onSelect(r.id)}
            now={now}
          />
          <VStack ref={tail} aria-hidden />
        </ScrollableArea>
      </VStack>
    </SidePanelLayout>
  )
}
