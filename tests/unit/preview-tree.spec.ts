import { describe, expect, it } from 'vitest'
import { buildTree } from '@/preview/tree'

describe('buildTree', () => {
  it('nests, hides tooling paths, folders first, natural order', () => {
    const tree = buildTree(
      ['b/x.md', 'a.txt', 'b/y.md', '.venv/z', 'uploads/u.png', 'file10.txt', 'file2.txt'].map((path) => ({ path })),
    )
    expect(tree.map((n) => n.name)).toEqual(['b', 'a.txt', 'file2.txt', 'file10.txt'])
    expect(tree[0].kind).toBe('dir')
    expect(tree[0].children.map((n) => n.path)).toEqual(['b/x.md', 'b/y.md'])
  })
  it('returns [] for no entries', () => {
    expect(buildTree([])).toEqual([])
  })
})
