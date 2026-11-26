'use client'

/**
 * "3 files changed +42 −7" after a finished turn: the files the turn changed,
 * each opening its diff in the side panel. Loads once when the turn completes
 * (or, for history, when the card scrolls into view); hidden when nothing was
 * recorded. Changes are kept in the API's memory only.
 */
import { Collapsible } from '@astryxdesign/core/Collapsible'
import { HStack } from '@astryxdesign/core/HStack'
import { Icon } from '@astryxdesign/core/Icon'
import { StackItem } from '@astryxdesign/core/Layout'
import { Text } from '@astryxdesign/core/Text'
import { VStack } from '@astryxdesign/core/VStack'
import { colorVars, radiusVars } from '@astryxdesign/core/theme/tokens.stylex'
import { DocumentTextIcon } from '@heroicons/react/24/outline'
import * as stylex from '@stylexjs/stylex'
import { useEffect, useRef, useState } from 'react'
import { api } from '@/api/client'
import type { TurnChangedFile, TurnChanges } from '@/api/types'
import type { ChatEntry } from '@/ui/chat/group-turns'
import { diffViewKey } from '@/preview/diff'
import { usePreviewPanel } from '@/preview/store'

const styles = stylex.create({
  card: {
    borderWidth: 1,
    borderStyle: 'solid',
    borderColor: colorVars['--color-border'],
    borderRadius: radiusVars['--radius-container'],
    paddingBlock: 8,
    paddingInline: 12,
  },
  row: {
    all: 'unset',
    boxSizing: 'border-box',
    display: 'block',
    inlineSize: '100%',
    cursor: 'pointer',
    paddingBlock: 4,
    paddingInline: 4,
    borderRadius: radiusVars['--radius-element'],
    backgroundColor: { default: 'transparent', ':hover': colorVars['--color-background-muted'] },
    outlineStyle: { default: 'none', ':focus-visible': 'solid' },
    outlineWidth: 2,
    outlineColor: colorVars['--color-accent'],
  },
  added: { color: colorVars['--color-text-success'] },
  deleted: { color: colorVars['--color-text-error'] },
})

const basename = (path: string) => path.split('/').pop() ?? path
const dirname = (path: string) => (path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '')

/** `+42 −7` in success and error colours. */
export function LineCounts({ added, deleted }: { added: number; deleted: number }) {
  return (
    <HStack gap={1}>
      <span {...stylex.props(styles.added)}><Text type="supporting" color="inherit" hasTabularNumbers>{`+${String(added)}`}</Text></span>
      <span {...stylex.props(styles.deleted)}><Text type="supporting" color="inherit" hasTabularNumbers>{`−${String(deleted)}`}</Text></span>
    </HStack>
  )
}

/** "3 files changed", plus "and 1 outside the workspace". */
export function changesLabel(c: { total: number; outside: number }): string {
  const files = `${String(c.total)} ${c.total === 1 ? 'file' : 'files'} changed`
  return c.outside > 0 ? `${files} and ${String(c.outside)} outside the workspace` : files
}

/** Rows of a turn's changed files; a click opens the file's diff tab. */
export function ChangedFiles({ turnId, files }: { turnId: string; files: TurnChangedFile[] }) {
  const { actions } = usePreviewPanel()
  return (
    <VStack gap={0}>
      {files.map((f) => (
        <button key={f.index} type="button" aria-label={`Show changes in ${f.path}`} onClick={() => actions.openView(diffViewKey(turnId, f.index), `${basename(f.path)} (changes)`)} {...stylex.props(styles.row)}>
          <HStack gap={2} vAlign="center">
            <Icon icon={DocumentTextIcon} size="sm" color="secondary" />
            <StackItem size="fill">
              <HStack gap={2} vAlign="center">
                <Text maxLines={1}>{basename(f.display)}</Text>
                {dirname(f.display) && <Text type="supporting" color="secondary" maxLines={1}>{dirname(f.display)}</Text>}
              </HStack>
            </StackItem>
            {f.binary ? <Text type="supporting" color="secondary">Binary</Text> : f.oversized ? <Text type="supporting" color="secondary">Large file</Text> : <LineCounts added={f.added} deleted={f.deleted} />}
          </HStack>
        </button>
      ))}
    </VStack>
  )
}

/** Shows when `turnId`'s changes once `completed`; in history, waits until the card is near the viewport. */
export function ChangesCard({ sessionId, turnId, completed, defaultOpen = false }: { sessionId: string; turnId: string; completed: boolean; defaultOpen?: boolean }) {
  const [changes, setChanges] = useState<TurnChanges | null>(null)
  const [visible, setVisible] = useState(typeof IntersectionObserver === 'undefined')
  const anchor = useRef<HTMLSpanElement>(null)
  useEffect(() => {
    if (visible || !anchor.current) return
    const io = new IntersectionObserver((seen) => {
      if (seen.some((e) => e.isIntersecting)) setVisible(true)
    }, { rootMargin: '400px' })
    io.observe(anchor.current)
    return () => io.disconnect()
  }, [visible])
  useEffect(() => {
    if (!completed || !visible) return
    const controller = new AbortController()
    api.turnChanges(sessionId, turnId, controller.signal).then(setChanges, () => {})
    return () => controller.abort()
  }, [sessionId, turnId, completed, visible])
  if (!changes) return <span ref={anchor} />
  if (!changes.available || changes.total + changes.outside === 0) return null
  return (
    <VStack xstyle={styles.card} data-testid="changes-card">
      <Collapsible
        defaultIsOpen={defaultOpen}
        trigger={
          <HStack gap={2} vAlign="center">
            <Text weight="medium">{changesLabel(changes)}</Text>
            <LineCounts added={changes.added} deleted={changes.deleted} />
          </HStack>
        }
      >
        <ChangedFiles turnId={turnId} files={changes.files} />
      </Collapsible>
    </VStack>
  )
}

const OPEN = new Set(['queued', 'in_progress', 'waiting'])

/**
 * Where each turn's Changes card goes: after the turn's last chat entry.
 * @returns entry index to `{ turnId, completed }`.
 */
export function changesPlacement(
  entries: readonly ChatEntry[],
  turnOf: ReadonlyMap<string, string>,
  turns: readonly { id: string; status: string }[],
): Map<number, { turnId: string; completed: boolean }> {
  const last = new Map<string, number>()
  entries.forEach((entry, i) => {
    const turnId = entry.type === 'group' ? entry.turnId : turnOf.get(entry.view.id)
    if (turnId) last.set(turnId, i)
  })
  const status = new Map(turns.map((t) => [t.id, t.status]))
  const out = new Map<number, { turnId: string; completed: boolean }>()
  for (const [turnId, i] of last) {
    const s = status.get(turnId)
    out.set(i, { turnId, completed: s !== undefined && !OPEN.has(s) })
  }
  return out
}
