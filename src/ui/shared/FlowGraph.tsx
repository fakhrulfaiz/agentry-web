'use client'

/** A small horizontal graph: one root card on the left joined by elbow lines to a column of node cards (status, title, meta); stacks vertically when narrow. */
import { Button } from '@astryxdesign/core/Button'
import { Icon } from '@astryxdesign/core/Icon'
import { StatusDot } from '@astryxdesign/core/StatusDot'
import { Text } from '@astryxdesign/core/Text'
import { colorVars, radiusVars, spacingVars } from '@astryxdesign/core/theme/tokens.stylex'
import * as stylex from '@stylexjs/stylex'
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ComponentType, type ReactNode, type SVGProps } from 'react'

export type FlowStatus = 'running' | 'needs' | 'done' | 'failed' | 'closed'

export interface FlowNode {
  id: string
  title: string
  status: FlowStatus
  meta: string[]
  onSelect?(): void
}

export interface FlowGraphProps {
  root: { title: string; subtitle?: string; icon?: ComponentType<SVGProps<SVGSVGElement>> }
  nodes: FlowNode[]
  selectedId?: string
}

/** Panel widths under this stack the graph (CSS pixels). */
const NARROW = 420

const DOT = { running: 'accent', needs: 'warning', done: 'success', failed: 'error', closed: 'neutral' } as const
const LABEL = { running: 'Running', needs: 'Needs you', done: 'Done', failed: 'Failed', closed: 'Closed' } as const

const styles = stylex.create({
  frame: { position: 'relative', display: 'flex', flexDirection: 'row', alignItems: 'center', gap: spacingVars['--spacing-12'], inlineSize: '100%', minInlineSize: 0 },
  frameNarrow: { flexDirection: 'column', alignItems: 'stretch', gap: spacingVars['--spacing-4'] },
  rootCol: { flexBasis: '34%', flexShrink: 0, minInlineSize: 0 },
  rootColNarrow: { flexBasis: 'auto' },
  nodes: { display: 'flex', flexDirection: 'column', gap: spacingVars['--spacing-3'], flexGrow: 1, minInlineSize: 0, listStyle: 'none', margin: 0, padding: 0 },
  nodesNarrow: { paddingInlineStart: spacingVars['--spacing-8'] },
  svg: { position: 'absolute', insetInlineStart: 0, insetBlockStart: 0, inlineSize: '100%', blockSize: '100%', pointerEvents: 'none', overflow: 'visible' },
  line: { fill: 'none', stroke: colorVars['--color-border-emphasized'], strokeWidth: 1.5 },
  lineLive: { stroke: colorVars['--color-accent'] },
  lineWait: { stroke: colorVars['--color-text-warning'] },
  card: {
    appearance: 'none',
    display: 'flex',
    flexDirection: 'column',
    gap: spacingVars['--spacing-1'],
    inlineSize: '100%',
    minInlineSize: 0,
    boxSizing: 'border-box',
    textAlign: 'start',
    font: 'inherit',
    color: 'inherit',
    paddingBlock: spacingVars['--spacing-2'],
    paddingInline: spacingVars['--spacing-3'],
    backgroundColor: colorVars['--color-background-card'],
    borderWidth: 1,
    borderStyle: 'solid',
    borderColor: colorVars['--color-border'],
    borderRadius: radiusVars['--radius-container'],
    cursor: { default: 'default', ':is(button)': 'pointer' },
    backgroundImage: { default: null, ':hover': `linear-gradient(${colorVars['--color-overlay-hover']}, ${colorVars['--color-overlay-hover']})` },
  },
  rootCard: { backgroundColor: colorVars['--color-background-muted'] },
  selected: { borderColor: colorVars['--color-accent'] },
  head: { display: 'flex', alignItems: 'center', gap: spacingVars['--spacing-2'], minInlineSize: 0 },
  grow: { flexGrow: 1, minInlineSize: 0 },
  nodeWrap: { display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: spacingVars['--spacing-1'] },
})

type Path = { d: string; kind: 'live' | 'wait' | 'idle'; key: string }

export function FlowGraph({ root, nodes, selectedId }: FlowGraphProps) {
  const frame = useRef<HTMLDivElement | null>(null)
  const rootEl = useRef<HTMLDivElement | null>(null)
  const nodeEls = useRef(new Map<string, HTMLElement>())
  const [narrow, setNarrow] = useState(false)
  const [paths, setPaths] = useState<Path[]>([])

  const measure = useCallback(() => {
    const f = frame.current
    const r = rootEl.current
    if (!f || !r) return
    const box = f.getBoundingClientRect()
    const rb = r.getBoundingClientRect()
    const isNarrow = box.width < NARROW
    setNarrow((cur) => (cur === isNarrow ? cur : isNarrow))
    const next: Path[] = []
    for (const n of nodes) {
      const el = nodeEls.current.get(n.id)
      if (!el) continue
      const b = (el.firstElementChild ?? el).getBoundingClientRect()
      const ny = b.top + b.height / 2 - box.top
      const nx = b.left - box.left
      const kind = n.status === 'needs' ? 'wait' : n.status === 'running' ? 'live' : 'idle'
      if (isNarrow) {
        const gx = Math.min(16, nx / 2)
        next.push({ key: n.id, kind, d: `M ${gx} ${rb.bottom - box.top} V ${ny} H ${nx}` })
      } else {
        const x1 = rb.right - box.left
        const y1 = rb.top + rb.height / 2 - box.top
        const mid = x1 + (nx - x1) / 2
        next.push({ key: n.id, kind, d: `M ${x1} ${y1} H ${mid} V ${ny} H ${nx}` })
      }
    }
    setPaths((cur) => (JSON.stringify(cur) === JSON.stringify(next) ? cur : next))
  }, [nodes])

  useLayoutEffect(measure)
  useEffect(() => {
    const f = frame.current
    if (!f || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(measure)
    ro.observe(f)
    return () => ro.disconnect()
  }, [measure])

  const RootIcon = root.icon
  return (
    <div ref={frame} data-testid="flow-graph" data-narrow={narrow || undefined} {...stylex.props(styles.frame, narrow && styles.frameNarrow)}>
      <svg aria-hidden="true" {...stylex.props(styles.svg)}>
        {paths.map((p) => (
          <path key={p.key} d={p.d} strokeDasharray={p.kind === 'idle' ? undefined : '4 3'} {...stylex.props(styles.line, p.kind === 'live' && styles.lineLive, p.kind === 'wait' && styles.lineWait)} />
        ))}
      </svg>
      <div {...stylex.props(styles.rootCol, narrow && styles.rootColNarrow)}>
        <div ref={rootEl} {...stylex.props(styles.card, styles.rootCard)}>
          <span {...stylex.props(styles.head)}>
            {RootIcon && <Icon icon={RootIcon} size="sm" color="secondary" />}
            <Text maxLines={1} weight="medium">{root.title}</Text>
          </span>
          {root.subtitle && <Text type="supporting" color="secondary" maxLines={1}>{root.subtitle}</Text>}
        </div>
      </div>
      <ul {...stylex.props(styles.nodes, narrow && styles.nodesNarrow)}>
        {nodes.map((n) => (
          <li
            key={n.id}
            ref={(el) => {
              if (el) nodeEls.current.set(n.id, el)
              else nodeEls.current.delete(n.id)
            }}
            {...stylex.props(styles.nodeWrap)}
          >
            <NodeCard node={n} selected={n.id === selectedId} />
            {n.status === 'needs' && n.onSelect && <Button label="Review" size="sm" variant="secondary" onClick={n.onSelect} />}
          </li>
        ))}
      </ul>
    </div>
  )
}

function NodeCard({ node, selected }: { node: FlowNode; selected: boolean }) {
  const body: ReactNode = (
    <>
      <span {...stylex.props(styles.head)}>
        <StatusDot variant={DOT[node.status]} label={LABEL[node.status]} isPulsing={node.status === 'running'} />
        <span {...stylex.props(styles.grow)}><Text maxLines={1} weight="medium">{node.title}</Text></span>
      </span>
      <Text type="supporting" color="secondary" maxLines={1} hasTabularNumbers>{[LABEL[node.status], ...node.meta].join(' · ')}</Text>
    </>
  )
  const props = stylex.props(styles.card, selected && styles.selected)
  return node.onSelect ? (
    <button type="button" aria-label={`Open ${node.title}`} aria-current={selected || undefined} onClick={node.onSelect} {...props}>{body}</button>
  ) : (
    <div {...props}>{body}</div>
  )
}

