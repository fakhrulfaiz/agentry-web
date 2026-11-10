'use client'

/** The sandbox file tree: ARIA tree with arrow/Enter/Left/Right keys. */
import { Text } from '@astryxdesign/core/Text'
import { useMemo, useState, type KeyboardEvent } from 'react'
import type { TreeNode } from '@/preview/tree'

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

export function FileTree({ tree, current, onOpen }: { tree: TreeNode[]; current?: string; onOpen(path: string): void }) {
  const [open, setOpen] = useState<Set<string>>(() => new Set())
  const [focus, setFocus] = useState(0)
  const rows = useMemo(() => flatten(tree, open), [tree, open])
  if (tree.length === 0)
    return (
      <Text type="supporting" color="secondary" role="status">
        No files yet.
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
    <ul role="tree" aria-label="Files" onKeyDown={onKey} style={{ listStyle: 'none', margin: 0, padding: 8 }}>
      {rows.map((row, i) => (
        <li
          key={row.node.path}
          role="treeitem"
          aria-level={row.depth + 1}
          aria-expanded={row.node.kind === 'dir' ? open.has(row.node.path) : undefined}
          aria-selected={row.node.path === current}
          tabIndex={i === focus ? 0 : -1}
          onFocus={() => setFocus(i)}
          onClick={() => activate(row)}
          title={row.node.size !== undefined ? `${row.node.size} bytes` : undefined}
          style={{
            paddingLeft: 8 + row.depth * 16,
            paddingBlock: 4,
            cursor: 'pointer',
            fontWeight: row.node.path === current ? 600 : 400,
          }}
        >
          <Text maxLines={1}>
            {row.node.kind === 'dir' ? (open.has(row.node.path) ? '▾ ' : '▸ ') : ''}
            {row.node.name}
          </Text>
        </li>
      ))}
    </ul>
  )
}
