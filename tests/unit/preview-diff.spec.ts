import { describe, expect, it } from 'vitest'
import { diffRows, diffViewKey, parseDiffKey, toPatch } from '@/preview/diff'

const hunks = [
  { old_start: 1, old_lines: 3, new_start: 1, new_lines: 4, lines: [' a', '-b', '+B', '+B2', ' c'] },
  { old_start: 16, old_lines: 1, new_start: 17, new_lines: 1, lines: ['-x', '+y'] },
]

describe('diffRows', () => {
  it('numbers lines across +, - and context, with a gap between hunks', () => {
    expect(diffRows(hunks)).toEqual([
      { kind: 'context', oldNo: 1, newNo: 1, text: 'a' },
      { kind: 'del', oldNo: 2, text: 'b' },
      { kind: 'add', newNo: 2, text: 'B' },
      { kind: 'add', newNo: 3, text: 'B2' },
      { kind: 'context', oldNo: 3, newNo: 4, text: 'c' },
      { kind: 'gap', hidden: 12 },
      { kind: 'del', oldNo: 16, text: 'x' },
      { kind: 'add', newNo: 17, text: 'y' },
    ])
  })
  it('starts with a gap when the first hunk is not at the top', () => {
    expect(diffRows([{ old_start: 5, old_lines: 1, new_start: 5, new_lines: 1, lines: [' z'] }])[0]).toEqual({ kind: 'gap', hidden: 4 })
  })
})

describe('toPatch', () => {
  it('writes unified diff headers', () => {
    const patch = toPatch('x', [hunks[0]])
    expect(patch.split('\n').slice(0, 3)).toEqual(['--- a/x', '+++ b/x', '@@ -1,3 +1,4 @@'])
    expect(toPatch('n', [], false, true).startsWith('--- /dev/null\n+++ b/n')).toBe(true)
  })
})

describe('diff view keys', () => {
  it('round-trips and rejects other keys', () => {
    expect(parseDiffKey(diffViewKey('turn_12', 3))).toEqual({ turnId: 'turn_12', index: 3 })
    expect(parseDiffKey('tasks')).toBeNull()
    expect(parseDiffKey('sub:abc')).toBeNull()
  })
})
