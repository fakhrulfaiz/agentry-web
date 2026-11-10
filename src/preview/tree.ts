/** The sandbox file tree: nests the backend's flat workspace listing. Client-safe and pure. */
import { isPresentedArtifact } from '@/artifacts/kind'

export interface TreeNode {
  name: string
  path: string
  kind: 'dir' | 'file'
  size?: number
  children: TreeNode[]
}

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' })

function sort(nodes: TreeNode[]): void {
  nodes.sort((a, b) => (a.kind === b.kind ? collator.compare(a.name, b.name) : a.kind === 'dir' ? -1 : 1))
  for (const node of nodes) sort(node.children)
}

/** Nests `entries` by `/`; hides tooling paths; folders first, then natural name order. */
export function buildTree(entries: { path: string; size?: number }[]): TreeNode[] {
  const roots: TreeNode[] = []
  for (const entry of entries) {
    if (!isPresentedArtifact(entry.path)) continue
    const parts = entry.path.split('/').filter(Boolean)
    let level = roots
    parts.forEach((name, i) => {
      const path = parts.slice(0, i + 1).join('/')
      const last = i === parts.length - 1
      let node = level.find((n) => n.name === name && n.kind === (last ? 'file' : 'dir'))
      if (!node) {
        node = { name, path, kind: last ? 'file' : 'dir', children: [], ...(last && entry.size !== undefined ? { size: entry.size } : {}) }
        level.push(node)
      }
      level = node.children
    })
  }
  sort(roots)
  return roots
}
