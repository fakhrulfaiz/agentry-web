'use client'

/**
 * The panel's Changes views: the Start-page card, the Changes tab (every turn
 * that changed files) and one file's diff tab (`diff:<turn>:<index>`). Tabs are
 * the panel's generic views (`openView`).
 */
import { Banner } from '@astryxdesign/core/Banner'
import { Button } from '@astryxdesign/core/Button'
import { EmptyState } from '@astryxdesign/core/EmptyState'
import { HStack } from '@astryxdesign/core/HStack'
import { Icon } from '@astryxdesign/core/Icon'
import { StackItem } from '@astryxdesign/core/Layout'
import { Skeleton } from '@astryxdesign/core/Skeleton'
import { Text } from '@astryxdesign/core/Text'
import { VStack } from '@astryxdesign/core/VStack'
import { colorVars, radiusVars, typographyVars } from '@astryxdesign/core/theme/tokens.stylex'
import { DocumentTextIcon, PencilSquareIcon, PresentationChartBarIcon, TableCellsIcon } from '@heroicons/react/24/outline'
import * as stylex from '@stylexjs/stylex'
import { useEffect, useMemo, useState, type ComponentType, type SVGProps } from 'react'
import { ApiError, api } from '@/api/client'
import type { TurnChangeDiff, TurnChangesListEntry } from '@/api/types'
import { diffRows, toPatch } from '@/preview/diff'
import { usePreviewPanel } from '@/preview/store'
import { ChangesCard } from '@/ui/chat/ChangesCard'

const styles = stylex.create({
  startCard: {
    all: 'unset',
    boxSizing: 'border-box',
    width: '100%',
    maxWidth: 380,
    display: 'flex',
    alignItems: 'center',
    gap: 12,
    padding: '12px 16px',
    cursor: 'pointer',
    borderWidth: 1,
    borderStyle: 'solid',
    borderColor: colorVars['--color-border'],
    borderRadius: radiusVars['--radius-container'],
    backgroundColor: { default: colorVars['--color-background-card'], ':hover': colorVars['--color-background-muted'] },
    outlineStyle: { default: 'none', ':focus-visible': 'solid' },
    outlineWidth: 2,
    outlineColor: colorVars['--color-accent'],
  },
  titles: { display: 'flex', flexDirection: 'column', minWidth: 0 },
  code: {
    fontFamily: typographyVars['--font-family-code'],
    fontSize: 12,
    lineHeight: 1.6,
    borderWidth: 1,
    borderStyle: 'solid',
    borderColor: colorVars['--color-border'],
    borderRadius: radiusVars['--radius-container'],
    overflowX: 'auto',
  },
  table: { borderCollapse: 'collapse', minWidth: '100%' },
  num: { color: colorVars['--color-text-secondary'], textAlign: 'end', paddingInline: 8, userSelect: 'none', whiteSpace: 'nowrap', verticalAlign: 'top' },
  sign: { inlineSize: 16, textAlign: 'center', userSelect: 'none', verticalAlign: 'top' },
  text: { whiteSpace: 'pre', paddingInlineEnd: 12 },
  add: { backgroundColor: colorVars['--color-success-muted'] },
  del: { backgroundColor: colorVars['--color-error-muted'] },
  gap: { backgroundColor: colorVars['--color-background-muted'], color: colorVars['--color-text-secondary'], paddingInline: 12 },
})

type IconType = ComponentType<SVGProps<SVGSVGElement>>
const basename = (path: string) => path.split('/').pop() ?? path

/** The header kind of an Office file shown as PDF pages. */
export function officeKind(path: string): { label: string; icon: IconType } {
  const ext = path.slice(path.lastIndexOf('.') + 1).toLowerCase()
  if (ext === 'ppt' || ext === 'pptx') return { label: 'Presentation', icon: PresentationChartBarIcon }
  if (ext === 'xls' || ext === 'xlsx') return { label: 'Table', icon: TableCellsIcon }
  return { label: 'Document', icon: DocumentTextIcon }
}

/** Start-page card that opens the Changes tab. */
const MEMORY_NOTE = 'Changes are kept until the server restarts.'

/** Every turn of the chat that changed files, newest first; each expands to its files. */
export function ChangesTab({ sessionId }: { sessionId: string }) {
  const [turns, setTurns] = useState<TurnChangesListEntry[] | null>(null)
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    const controller = new AbortController()
    api.sessionChanges(sessionId, controller.signal).then((r) => setTurns(r.data), () => {
      if (!controller.signal.aborted) setFailed(true)
    })
    return () => controller.abort()
  }, [sessionId])
  if (failed) return <Banner status="error" title="Could not load the changes." />
  if (!turns) return <Skeleton height={120} />
  if (turns.length === 0) return <EmptyState title="No changes yet" description={`Files the agent changes in a turn are listed here. ${MEMORY_NOTE}`} headingLevel={2} />
  return (
    <VStack gap={3} data-testid="changes-list">
      <Text type="supporting" color="secondary">{MEMORY_NOTE}</Text>
      {turns.map((t, i) => (
        <VStack key={t.turn_id} gap={1}>
          <Text type="supporting" color="secondary">{i === 0 ? 'Latest turn' : `Turn ${String(turns.length - i)}`}</Text>
          <ChangesCard sessionId={sessionId} turnId={t.turn_id} completed defaultOpen={i === 0} />
        </VStack>
      ))}
    </VStack>
  )
}

/** One changed file's unified diff, with Open file and Copy patch. */
export function DiffView({ sessionId, turnId, index }: { sessionId: string; turnId: string; index: number }) {
  const { actions } = usePreviewPanel()
  const [state, setState] = useState<{ status: 'loading' } | { status: 'ok'; diff: TurnChangeDiff } | { status: 'gone' } | { status: 'error' }>({ status: 'loading' })
  const [copied, setCopied] = useState(false)
  useEffect(() => {
    const controller = new AbortController()
    setState({ status: 'loading' })
    api.turnChangeDiff(sessionId, turnId, index, controller.signal).then(
      (diff) => setState({ status: 'ok', diff }),
      (error: unknown) => {
        if (controller.signal.aborted) return
        setState(error instanceof ApiError && error.status === 404 ? { status: 'gone' } : { status: 'error' })
      },
    )
    return () => controller.abort()
  }, [sessionId, turnId, index])
  const rows = useMemo(() => (state.status === 'ok' ? diffRows(state.diff.hunks ?? []) : []), [state])
  if (state.status === 'loading') return <Skeleton height={160} />
  if (state.status === 'gone') return <EmptyState title="These changes are no longer available." description={MEMORY_NOTE} headingLevel={2} />
  if (state.status === 'error') return <Banner status="error" title="Could not load the changes." />
  const { diff } = state
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(toPatch(diff.path, diff.hunks ?? [], diff.before !== false, diff.after !== false))
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {}
  }
  const deleted = diff.kind === 'text' && diff.after === false
  return (
    <VStack gap={3} data-testid="diff-view">
      <HStack gap={2} vAlign="center">
        <StackItem size="fill">
          <Text type="supporting" color="secondary" maxLines={1}>{diff.display}</Text>
        </StackItem>
        {!deleted && <Button label="Open file" size="sm" onClick={() => actions.openFile(diff.path)} />}
        {diff.kind === 'text' && <Button label={copied ? 'Copied' : 'Copy patch'} size="sm" onClick={() => void copy()} />}
      </HStack>
      {diff.kind === 'binary' && <Text color="secondary">{`${basename(diff.path)} is a binary file; no line changes to show.`}</Text>}
      {diff.kind === 'oversized' && <Text color="secondary">{`${basename(diff.path)} is too large to compare.`}</Text>}
      {diff.kind === 'text' && rows.length === 0 && <Text color="secondary">No line changes.</Text>}
      {diff.kind === 'text' && rows.length > 0 && (
        <div {...stylex.props(styles.code)}>
          <table {...stylex.props(styles.table)}>
            <tbody>
              {rows.map((row, i) =>
                row.kind === 'gap' ? (
                  <tr key={i}>
                    <td colSpan={4} {...stylex.props(styles.gap)}>{`⋯ ${String(row.hidden)} unchanged ${row.hidden === 1 ? 'line' : 'lines'}`}</td>
                  </tr>
                ) : (
                    <tr key={i} data-kind={row.kind} {...stylex.props(row.kind === 'add' && styles.add, row.kind === 'del' && styles.del)}>
                      <td {...stylex.props(styles.num)}>{row.oldNo ?? ''}</td>
                      <td {...stylex.props(styles.num)}>{row.newNo ?? ''}</td>
                      <td {...stylex.props(styles.sign)}>{row.kind === 'add' ? '+' : row.kind === 'del' ? '−' : ''}</td>
                      <td {...stylex.props(styles.text)}>{row.text}</td>
                    </tr>
                ),
              )}
            </tbody>
          </table>
        </div>
      )}
    </VStack>
  )
}
