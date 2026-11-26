/** Diff layout for the panel's diff tabs: hunks to numbered rows, a patch for Copy, and the tab key. Pure. */
import type { TurnChangeHunk } from '@/api/types'

export type DiffRow =
  | { kind: 'context' | 'add' | 'del'; oldNo?: number; newNo?: number; text: string }
  | { kind: 'gap'; hidden: number }

/** Rows with old/new line numbers; a `gap` row between hunks counts the unchanged lines skipped. */
export function diffRows(hunks: readonly TurnChangeHunk[]): DiffRow[] {
  const rows: DiffRow[] = []
  hunks.forEach((hunk, i) => {
    if (i > 0) {
      const prev = hunks[i - 1]
      const hidden = hunk.old_start - (prev.old_start + prev.old_lines)
      if (hidden > 0) rows.push({ kind: 'gap', hidden })
    } else if (hunk.old_start > 1) {
      rows.push({ kind: 'gap', hidden: hunk.old_start - 1 })
    }
    let oldNo = hunk.old_start
    let newNo = hunk.new_start
    for (const line of hunk.lines) {
      const text = line.slice(1)
      if (line.startsWith('+')) rows.push({ kind: 'add', newNo: newNo++, text })
      else if (line.startsWith('-')) rows.push({ kind: 'del', oldNo: oldNo++, text })
      else rows.push({ kind: 'context', oldNo: oldNo++, newNo: newNo++, text })
    }
  })
  return rows
}

/** A unified diff text for one file, for Copy patch. */
export function toPatch(path: string, hunks: readonly TurnChangeHunk[], before = true, after = true): string {
  const out = [`--- ${before ? `a/${path}` : '/dev/null'}`, `+++ ${after ? `b/${path}` : '/dev/null'}`]
  for (const h of hunks) {
    out.push(`@@ -${h.old_start},${h.old_lines} +${h.new_start},${h.new_lines} @@`)
    out.push(...h.lines)
  }
  return `${out.join('\n')}\n`
}

/** The panel view key of one file's diff tab. */
export const diffViewKey = (turnId: string, index: number) => `diff:${turnId}:${String(index)}`

/** `{ turnId, index }` of a diff view key, or `null` for any other view. */
export function parseDiffKey(key: string): { turnId: string; index: number } | null {
  const m = /^diff:([A-Za-z0-9_-]+):(\d+)$/.exec(key)
  return m ? { turnId: m[1], index: Number(m[2]) } : null
}
