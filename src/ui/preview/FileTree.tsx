'use client'

/** The sandbox file tree: ARIA tree with arrow/Enter/Left/Right keys. */
import { Icon } from '@astryxdesign/core/Icon'
import { Text } from '@astryxdesign/core/Text'
import { colorVars, radiusVars } from '@astryxdesign/core/theme/tokens.stylex'
import { ChevronDownIcon, ChevronRightIcon, DocumentIcon, FolderIcon } from '@heroicons/react/24/outline'
import * as stylex from '@stylexjs/stylex'
import { useMemo, useState, type KeyboardEvent, type ReactNode } from 'react'
import type { TreeNode } from '@/preview/tree'

const styles = stylex.create({
  list: { listStyle: 'none', margin: 0, padding: 8 },
  row: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    minWidth: 0,
    paddingBlock: 6,
    paddingInlineEnd: 8,
    borderRadius: radiusVars['--radius-element'],
    cursor: 'pointer',
    outlineStyle: { default: 'none', ':focus-visible': 'solid' },
    outlineWidth: 2,
    outlineColor: colorVars['--color-accent'],
    backgroundColor: { default: 'transparent', ':hover': colorVars['--color-overlay-hover'] },
  },
  selected: { backgroundColor: colorVars['--color-background-muted'] },
  indent: (px: number) => ({ paddingInlineStart: 8 + px }),
  lead: { flexShrink: 0, display: 'inline-flex', color: colorVars['--color-text-secondary'] },
  name: { flex: 1, minWidth: 0 },
  spacer: { flexShrink: 0, width: 16 },
})

interface Row {
  node: TreeNode
  depth: number
}

function flatten(nodes: TreeNode[], open: Set<string>, depth = 0): Row[] {
  return nodes.flatMap((node) => [
    { node, depth },
    ...(node.kind === 'dir' && open.has(node.path) ? flatten(node.children, open, depth + 1) : []),
  ])
}

export function FileTree({ tree, current, onOpen, renderEnd, emptyText, expandTop = false }: {
  tree: TreeNode[]
  current?: string
  onOpen(path: string): void
  /** Extra content at the end of a row (a size, a download link). */
  renderEnd?(node: TreeNode): ReactNode
  /** Shown when there is nothing to list. */
  emptyText?: string
  /** Start with the top-level folders open. */
  expandTop?: boolean
}) {
  const [open, setOpen] = useState<Set<string>>(() => new Set(expandTop ? tree.filter((n) => n.kind === 'dir').map((n) => n.path) : []))
  const [focus, setFocus] = useState(0)
  const rows = useMemo(() => flatten(tree, open), [tree, open])
  if (tree.length === 0)
    return (
      <Text type="supporting" color="secondary" role="status">
        {emptyText ?? 'No files yet. Files the agent creates will show up here.'}
      </Text>
    )
  const toggle = (path: string, to?: boolean) =>
    setOpen((cur) => {
      const next = new Set(cur)
      if (to ?? !next.has(path)) next.add(path)
      else next.delete(path)
      return next
    })
  const activate = (row: Row) => (row.node.kind === 'dir' ? toggle(row.node.path) : onOpen(row.node.path))
  const onKey = (e: KeyboardEvent) => {
    const row = rows[focus]
    if (!row) return
    if (e.key === 'ArrowDown') setFocus(Math.min(rows.length - 1, focus + 1))
    else if (e.key === 'ArrowUp') setFocus(Math.max(0, focus - 1))
    else if (e.key === 'ArrowRight' && row.node.kind === 'dir') toggle(row.node.path, true)
    else if (e.key === 'ArrowLeft' && row.node.kind === 'dir') toggle(row.node.path, false)
    else if (e.key === 'Enter' || e.key === ' ') activate(row)
    else return
    e.preventDefault()
  }
  return (
    <ul role="tree" aria-label="Files" onKeyDown={onKey} {...stylex.props(styles.list)}>
      {rows.map(({ node, depth }, i) => (
        <li
          key={node.path}
          role="treeitem"
          aria-level={depth + 1}
          aria-expanded={node.kind === 'dir' ? open.has(node.path) : undefined}
          aria-selected={node.path === current}
          tabIndex={i === focus ? 0 : -1}
          onFocus={() => setFocus(i)}
          onClick={() => activate({ node, depth })}
          title={node.size !== undefined ? `${node.size} bytes` : undefined}
          {...stylex.props(styles.row, styles.indent(depth * 16), node.path === current && styles.selected)}
        >
          {node.kind === 'dir' ? (
            <>
              <span {...stylex.props(styles.lead)}>
                <Icon icon={open.has(node.path) ? ChevronDownIcon : ChevronRightIcon} size="sm" />
              </span>
              <span {...stylex.props(styles.lead)}>
                <Icon icon={FolderIcon} size="sm" />
              </span>
            </>
          ) : (
            <>
              <span {...stylex.props(styles.spacer)} />
              <span {...stylex.props(styles.lead)}>
                <Icon icon={DocumentIcon} size="sm" />
              </span>
            </>
          )}
          <span {...stylex.props(styles.name)}><Text maxLines={1}>{node.name}</Text></span>
          {renderEnd?.(node)}
        </li>
      ))}
    </ul>
  )
}
