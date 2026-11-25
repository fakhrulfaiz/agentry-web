'use client'

/**
 * The timing overview above the ledger: lanes for turns, assistant steps, tool
 * calls and subagent runs, each span placed by its recorded start and duration
 * (a running span reaches now). An assistant step shows its wait for the first
 * token lighter than its generation. Records without recorded timing are left
 * out. "Duration" off gives every span the same width, in order.
 *
 * Drag across it to focus the ledger on that interval; the wheel zooms around
 * the pointer; a right-button click clears the interval and the zoom. Hovering
 * a span (500 ms) shows its start and duration.
 */
import { HStack } from '@astryxdesign/core/HStack'
import { Text } from '@astryxdesign/core/Text'
import { Tooltip } from '@astryxdesign/core/Tooltip'
import { VStack } from '@astryxdesign/core/VStack'
import { dataVars } from '@astryxdesign/core/theme/dataTokens.stylex'
import { colorVars, radiusVars, spacingVars } from '@astryxdesign/core/theme/tokens.stylex'
import * as stylex from '@stylexjs/stylex'
import { useRef, useState, type PointerEvent, type WheelEvent } from 'react'
import type { TimelineSpan } from './build-trajectory'
import { formatClock, formatSeconds } from './format'

export type Interval = { from: number; to: number }

const styles = stylex.create({
  area: {
    position: 'relative',
    flexGrow: 1,
    minInlineSize: 0,
    blockSize: `calc(${spacingVars['--spacing-4']} * 4 + ${spacingVars['--spacing-1']} * 2)`,
    borderRadius: radiusVars['--radius-inner'],
    backgroundColor: colorVars['--color-background-muted'],
    overflow: 'hidden',
    cursor: 'crosshair',
    touchAction: 'none',
    userSelect: 'none',
  },
  span: (left: string, width: string, top: string) => ({
    position: 'absolute',
    insetInlineStart: left,
    inlineSize: width,
    insetBlockStart: top,
    blockSize: spacingVars['--spacing-2'],
    minInlineSize: spacingVars['--spacing-0-5'],
  }),
  // The kind chip colours: assistant teal, tool orange, a subagent run its subtools' pink; a turn is neutral.
  turn: { backgroundColor: colorVars['--color-border-emphasized'] },
  assistant: { backgroundColor: dataVars['--color-data-categorical-teal'], opacity: 0.85 },
  tool: { backgroundColor: dataVars['--color-data-categorical-orange'], opacity: 0.85 },
  subagent: { backgroundColor: dataVars['--color-data-categorical-pink'], opacity: 0.8 },
  // The wait before the first token, inside an assistant span.
  waiting: (width: string) => ({
    position: 'absolute',
    insetBlock: 0,
    insetInlineStart: 0,
    inlineSize: width,
    backgroundColor: colorVars['--color-background-muted'],
    opacity: 0.55,
  }),
  failed: { backgroundColor: dataVars['--color-data-categorical-red'], opacity: 0.85 },
  laneLabel: { blockSize: spacingVars['--spacing-4'] },
  selection: (left: string, width: string) => ({
    position: 'absolute',
    insetBlock: 0,
    insetInlineStart: left,
    inlineSize: width,
    backgroundColor: colorVars['--color-overlay-hover'],
    borderInlineWidth: 1,
    borderInlineStyle: 'solid',
    borderColor: colorVars['--color-accent'],
  }),
})

const LANES = [
  { key: 'turn', label: 'Turns' },
  { key: 'assistant', label: 'Assistant' },
  { key: 'tool', label: 'Tools' },
  { key: 'subagent', label: 'Subagents' },
] as const

// Each lane is a --spacing-4 row; its bar is centred in it.
const LANE_TOP = Object.fromEntries(
  LANES.map((lane, i) => [lane.key, `calc(${spacingVars['--spacing-1']} * 2 + ${spacingVars['--spacing-4']} * ${String(i)})`]),
) as Record<TimelineSpan['lane'], string>

/** The hover text of a span: what it is, when it started, and how long each part took. */
export function spanDetails(span: TimelineSpan): string {
  const parts = [span.label, `Started ${formatClock(span.start)}`]
  if (span.firstToken !== undefined) parts.push(`First token ${formatSeconds(span.firstToken - span.start)}`)
  if (span.end !== undefined && span.firstToken !== undefined) parts.push(`Generating ${formatSeconds(span.end - span.firstToken)}`)
  parts.push(span.end !== undefined ? `Total ${formatSeconds(span.end - span.start)}` : 'Running')
  return parts.join(' · ')
}

interface Placed {
  span: TimelineSpan
  left: number
  width: number
}

/** Span positions as fractions of the area, for the current domain or equal widths. */
function place(spans: TimelineSpan[], now: number, actual: boolean, domain: Interval): Placed[] {
  if (!actual) {
    const n = spans.length
    return spans.map((span, i) => ({ span, left: i / n, width: 1 / n }))
  }
  const size = Math.max(domain.to - domain.from, 1e-6)
  return spans.map((span) => {
    const end = span.end ?? now
    return { span, left: (span.start - domain.from) / size, width: Math.max(end - span.start, 0) / size }
  })
}

export function fullDomain(spans: TimelineSpan[], now: number): Interval | null {
  if (spans.length === 0) return null
  const from = Math.min(...spans.map((s) => s.start))
  const to = Math.max(...spans.map((s) => s.end ?? now))
  return { from, to: to > from ? to : from + 1 }
}

const pct = (f: number) => `${(f * 100).toFixed(3)}%`

export function Overview({
  spans,
  now,
  actual,
  interval,
  onIntervalChange,
}: {
  spans: TimelineSpan[]
  now: number
  actual: boolean
  interval: Interval | null
  onIntervalChange(interval: Interval | null): void
}) {
  const area = useRef<HTMLElement | null>(null)
  const [zoom, setZoom] = useState<Interval | null>(null)
  const [drag, setDrag] = useState<{ a: number; b: number } | null>(null)
  const full = fullDomain(spans, now)
  if (!full) {
    return (
      <Text type="supporting" data-testid="trajectory-overview">
        No timing data
      </Text>
    )
  }
  const domain = actual && zoom ? zoom : full
  const placed = place(spans, now, actual, domain)

  const fractionAt = (clientX: number) => {
    const box = area.current?.getBoundingClientRect()
    if (!box || box.width === 0) return 0
    return Math.min(1, Math.max(0, (clientX - box.left) / box.width))
  }
  /** A fraction range as a time interval: by the domain, or by the spans it covers (equal widths). */
  const toInterval = (a: number, b: number): Interval => {
    const [lo, hi] = a < b ? [a, b] : [b, a]
    if (actual) return { from: domain.from + lo * (domain.to - domain.from), to: domain.from + hi * (domain.to - domain.from) }
    const covered = placed.filter((p) => p.left + p.width >= lo && p.left <= hi).map((p) => p.span)
    const list = covered.length > 0 ? covered : spans
    return { from: Math.min(...list.map((s) => s.start)), to: Math.max(...list.map((s) => s.end ?? now)) }
  }

  const onPointerDown = (e: PointerEvent<HTMLElement>) => {
    if (e.button !== 0) return
    e.currentTarget.setPointerCapture?.(e.pointerId)
    const f = fractionAt(e.clientX)
    setDrag({ a: f, b: f })
  }
  const onPointerMove = (e: PointerEvent<HTMLElement>) => {
    if (drag) setDrag({ a: drag.a, b: fractionAt(e.clientX) })
  }
  const onPointerUp = () => {
    if (!drag) return
    if (Math.abs(drag.b - drag.a) > 0.005) onIntervalChange(toInterval(drag.a, drag.b))
    setDrag(null)
  }
  const onWheel = (e: WheelEvent<HTMLElement>) => {
    if (!actual) return
    const f = fractionAt(e.clientX)
    const span = domain.to - domain.from
    const next = span * (e.deltaY > 0 ? 1.25 : 0.8)
    if (next >= full.to - full.from) return setZoom(null)
    const at = domain.from + f * span
    setZoom({ from: at - f * next, to: at + (1 - f) * next })
  }

  // The focused interval, drawn in the current domain.
  let mark: { left: number; width: number } | null = null
  if (drag) mark = { left: Math.min(drag.a, drag.b), width: Math.abs(drag.b - drag.a) }
  else if (interval && actual) {
    const size = domain.to - domain.from
    mark = { left: (interval.from - domain.from) / size, width: (interval.to - interval.from) / size }
  }

  return (
    <VStack gap={1}>
      <HStack gap={2}>
        <VStack paddingBlock={1} aria-hidden>
          {LANES.map((lane) => (
            <HStack key={lane.key} vAlign="center" hAlign="end" xstyle={styles.laneLabel}>
              <Text type="supporting" size="xsm">
                {lane.label}
              </Text>
            </HStack>
          ))}
        </VStack>
        <VStack
          ref={area}
          xstyle={styles.area}
          role="group"
          aria-label="Timeline overview; drag horizontally to focus events"
          data-testid="trajectory-overview"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={() => setDrag(null)}
          onWheel={onWheel}
          onContextMenu={(e) => {
            e.preventDefault()
            setZoom(null)
            onIntervalChange(null)
          }}
        >
          {placed.map(({ span, left, width }) => (
            <Tooltip key={span.id} delay={500} content={spanDetails(span)}>
              <VStack
                aria-label={span.label}
                data-testid="trajectory-span"
                data-lane={span.lane}
                xstyle={[styles.span(pct(left), pct(width), LANE_TOP[span.lane]), span.status === 'failed' ? styles.failed : styles[span.lane]]}
              >
                {span.firstToken !== undefined && (span.end ?? now) > span.start && (
                  <VStack
                    aria-hidden
                    xstyle={styles.waiting(pct(Math.min(1, Math.max(0, (span.firstToken - span.start) / ((span.end ?? now) - span.start)))))}
                  />
                )}
              </VStack>
            </Tooltip>
          ))}
          {mark && <VStack xstyle={styles.selection(pct(mark.left), pct(mark.width))} />}
        </VStack>
      </HStack>
      {interval && (
        <HStack gap={2}>
          <Text type="supporting" size="xsm" hasTabularNumbers>
            Focused {formatClock(interval.from)} – {formatSeconds(interval.to - interval.from)}
          </Text>
        </HStack>
      )}
    </VStack>
  )
}
