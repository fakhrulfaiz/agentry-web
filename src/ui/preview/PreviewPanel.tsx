'use client'

/**
 * The chat's right-hand preview panel, in the manner of claude.ai's artifact
 * panel: a floating card whose header carries the file's identity on the left
 * and, on the right, a Preview | Code switch with icon actions. The sandbox tree
 * opens beside the file from the folder icon. Resizable; Escape closes it.
 */
import { Icon } from '@astryxdesign/core/Icon'
import { IconButton } from '@astryxdesign/core/IconButton'
import { Text } from '@astryxdesign/core/Text'
import { ToggleButton, ToggleButtonGroup } from '@astryxdesign/core/ToggleButton'
import { colorVars, radiusVars } from '@astryxdesign/core/theme/tokens.stylex'
import {
  ArrowDownTrayIcon,
  CheckIcon,
  ClipboardDocumentIcon,
  CodeBracketIcon,
  DocumentIcon,
  DocumentTextIcon,
  FolderIcon,
  PhotoIcon,
  TableCellsIcon,
  XMarkIcon,
} from '@heroicons/react/24/outline'
import * as stylex from '@stylexjs/stylex'
import { useCallback, useEffect, useMemo, useRef, useState, type ComponentType, type KeyboardEvent, type PointerEvent, type SVGProps } from 'react'
import { api } from '@/api/client'
import { type RendererId, renderersFor } from '@/preview/renderers'
import { MAX_WIDTH, MIN_WIDTH, usePreviewPanel } from '@/preview/store'
import { buildTree, type TreeNode } from '@/preview/tree'
import { fileUrl } from '@/preview/use-file-bytes'
import { FileTree } from './FileTree'
import { RendererBody } from './renderers'

const styles = stylex.create({
  shell: (width: number) => ({
    position: { default: 'relative', '@media (max-width: 767px)': 'fixed' },
    inset: { default: 'auto', '@media (max-width: 767px)': 0 },
    zIndex: { default: 'auto', '@media (max-width: 767px)': 20 },
    width,
    minWidth: { default: 0, '@media (max-width: 767px)': '100%' },
    flexShrink: 0,
    display: 'flex',
    minHeight: 0,
    padding: { default: '8px 8px 8px 0', '@media (max-width: 767px)': 0 },
    boxSizing: 'border-box',
    backgroundColor: { default: 'transparent', '@media (max-width: 767px)': colorVars['--color-background-body'] },
  }),
  grip: { width: 8, flexShrink: 0, cursor: 'col-resize', display: { default: 'block', '@media (max-width: 767px)': 'none' } },
  card: {
    flex: 1,
    minWidth: 0,
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
    borderWidth: 1,
    borderStyle: 'solid',
    borderColor: colorVars['--color-border'],
    borderRadius: radiusVars['--radius-container'],
    backgroundColor: colorVars['--color-background-card'],
  },
  header: { display: 'flex', alignItems: 'center', gap: 12, padding: '12px 12px 12px 16px', flexShrink: 0 },
  identity: { display: 'flex', alignItems: 'center', gap: 12, minWidth: 0, flex: 1 },
  tile: {
    flexShrink: 0,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: 36,
    height: 36,
    borderRadius: radiusVars['--radius-element'],
    backgroundColor: colorVars['--color-background-muted'],
    color: colorVars['--color-text-secondary'],
  },
  titles: { minWidth: 0, display: 'flex', flexDirection: 'column' },
  actions: { display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0 },
  tabs: {
    display: 'flex',
    gap: 4,
    padding: '0 12px 8px',
    overflowX: 'auto',
    flexShrink: 0,
  },
  chip: {
    display: 'flex',
    alignItems: 'center',
    maxWidth: 180,
    borderRadius: radiusVars['--radius-element'],
    paddingInlineStart: 10,
    cursor: 'pointer',
    borderWidth: 1,
    borderStyle: 'solid',
    borderColor: colorVars['--color-border'],
  },
  chipActive: { backgroundColor: colorVars['--color-background-muted'] },
  chipLabel: { all: 'unset', cursor: 'pointer', minWidth: 0, paddingBlock: 4 },
  divider: { height: 1, flexShrink: 0, backgroundColor: colorVars['--color-border'] },
  body: { flex: 1, minHeight: 0, display: 'flex' },
  tree: { width: 232, flexShrink: 0, overflow: 'auto', borderInlineEnd: `1px solid ${colorVars['--color-border']}` },
  content: { flex: 1, minWidth: 0, position: 'relative', overflow: 'auto' },
  filesPage: { flex: 1, minWidth: 0, overflow: 'auto', padding: 8 },
})

type IconType = ComponentType<SVGProps<SVGSVGElement>>

const basename = (path: string) => path.split('/').pop() ?? path
const extOf = (path: string) => path.slice(path.lastIndexOf('.') + 1).toUpperCase()

/** Preview-side renderers vs code-side ones, for the two-way header switch. */
const SIDE: Record<RendererId, 'preview' | 'code'> = {
  markdown: 'preview', html: 'preview', table: 'preview', json: 'preview', image: 'preview', pdf: 'preview', docx: 'preview', download: 'preview',
  code: 'code', source: 'code', text: 'code',
}
const TEXT_LIKE = new Set<RendererId>(['markdown', 'html', 'table', 'json', 'code', 'source', 'text'])

function kindOf(path: string, id: RendererId): { label: string; icon: IconType } {
  if (id === 'image') return { label: 'Image', icon: PhotoIcon }
  if (id === 'pdf') return { label: 'PDF', icon: DocumentIcon }
  if (id === 'table') return { label: 'Table', icon: TableCellsIcon }
  if (id === 'markdown' || id === 'docx') return { label: 'Document', icon: DocumentTextIcon }
  if (id === 'download') return { label: 'File', icon: DocumentIcon }
  return { label: id === 'html' ? 'Web page' : 'Code', icon: CodeBracketIcon }
}

function formatBytes(n?: number): string {
  if (n === undefined) return ''
  if (n < 1024) return `${n} B`
  return n < 1024 * 1024 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`
}

function FileView({
  sessionId, path, size, tree, reloadKey, onMissing,
}: { sessionId: string; path: string; size?: number; tree: TreeNode[]; reloadKey: number; onMissing(): void }) {
  const { state, actions } = usePreviewPanel()
  const choices = useMemo(() => renderersFor(basename(path)), [path])
  const [chosen, setChosen] = useState<RendererId | null>(null)
  const [runScripts, setRunScripts] = useState(false)
  const [retry, setRetry] = useState(0)
  const [copied, setCopied] = useState(false)
  useEffect(() => {
    setChosen(null)
    setRunScripts(false)
  }, [path])
  const id = chosen ?? choices.default
  const previewId = choices.options.find((o) => SIDE[o] === 'preview')
  const codeId = choices.options.find((o) => SIDE[o] === 'code')
  const switchable = previewId !== undefined && codeId !== undefined && previewId !== 'download'
  const kind = kindOf(path, choices.default)
  const copy = async () => {
    try {
      const text = TEXT_LIKE.has(choices.default) ? await (await fetch(fileUrl(sessionId, path))).text() : path
      await navigator.clipboard.writeText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {}
  }
  return (
    <>
      <div {...stylex.props(styles.header)}>
        <div {...stylex.props(styles.identity)}>
          <span {...stylex.props(styles.tile)}>
            <Icon icon={kind.icon} size="md" />
          </span>
          <div {...stylex.props(styles.titles)}>
            <Text weight="medium" maxLines={1}>{basename(path)}</Text>
            <Text type="supporting" color="secondary" maxLines={1}>
              {[extOf(path) !== basename(path).toUpperCase() ? extOf(path) : kind.label, formatBytes(size)].filter(Boolean).join(' · ')}
            </Text>
          </div>
        </div>
        <div {...stylex.props(styles.actions)}>
          {id === 'html' && (
            <ToggleButton label="Run scripts" size="sm" tooltip="Let the page run its scripts. It still cannot reach this app." isPressed={runScripts} onPressedChange={setRunScripts} />
          )}
          {switchable && (
            <ToggleButtonGroup label="View" size="sm" value={SIDE[id]} onChange={(v) => typeof v === 'string' && setChosen(v === 'preview' ? previewId! : codeId!)}>
              <ToggleButton value="preview" label="Preview" />
              <ToggleButton value="code" label="Code" />
            </ToggleButtonGroup>
          )}
          <IconButton label={copied ? 'Copied' : 'Copy'} tooltip={copied ? 'Copied' : 'Copy'} variant="ghost" size="sm" icon={<Icon icon={copied ? CheckIcon : ClipboardDocumentIcon} size="sm" />} onClick={() => void copy()} />
          <IconButton label="Download" tooltip="Download" variant="ghost" size="sm" href={fileUrl(sessionId, path, true)} icon={<Icon icon={ArrowDownTrayIcon} size="sm" />} />
          <IconButton label="Files" tooltip="Files" variant="ghost" size="sm" icon={<Icon icon={FolderIcon} size="sm" />} onClick={actions.toggleTree} />
          <IconButton label="Close preview" tooltip="Close" variant="ghost" size="sm" icon={<Icon icon={XMarkIcon} size="sm" />} onClick={actions.close} />
        </div>
      </div>
      <div {...stylex.props(styles.divider)} />
      <div {...stylex.props(styles.body)}>
        {state.treeVisible && (
          <div {...stylex.props(styles.tree)}>
            <FileTree tree={tree} current={path} onOpen={actions.openFile} />
          </div>
        )}
        <div {...stylex.props(styles.content)}>
          <RendererBody id={id} sessionId={sessionId} path={path} reloadKey={reloadKey + retry} wrap runScripts={runScripts} onMissing={onMissing} onRetry={() => setRetry((k) => k + 1)} />
        </div>
      </div>
    </>
  )
}

export function PreviewPanel({ sessionId, idle }: { sessionId: string; idle: boolean }) {
  const { state, actions } = usePreviewPanel()
  const [entries, setEntries] = useState<{ path: string; size?: number }[]>([])
  const [reloadKey, setReloadKey] = useState(0)
  const load = useCallback(() => {
    api.listSessionArtifacts(sessionId).then((l) => setEntries(l.data), () => setEntries([]))
  }, [sessionId])
  const wasIdle = useRef(idle)
  useEffect(() => {
    // Files change only while a turn runs; refresh the tree and the open file on every return to idle.
    if (state.open && idle) {
      load()
      if (!wasIdle.current) setReloadKey((k) => k + 1)
    }
    wasIdle.current = idle
  }, [state.open, idle, load])
  const tree = useMemo(() => buildTree(entries), [entries])

  if (!state.open) return null
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') actions.close()
  }
  const startDrag = (e: PointerEvent) => {
    const startX = e.clientX
    const startW = state.width
    const move = (ev: globalThis.PointerEvent) => actions.setWidth(startW + (startX - ev.clientX))
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }
  const onResizeKey = (e: KeyboardEvent) => {
    if (e.key === 'ArrowLeft') actions.setWidth(state.width + 24)
    else if (e.key === 'ArrowRight') actions.setWidth(state.width - 24)
    else return
    e.preventDefault()
  }
  const showingFiles = state.active === 'files'
  return (
    <div data-testid="preview-panel" onKeyDown={onKey} {...stylex.props(styles.shell(state.width))}>
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize preview"
        aria-valuenow={state.width}
        aria-valuemin={MIN_WIDTH}
        aria-valuemax={MAX_WIDTH}
        tabIndex={0}
        onPointerDown={startDrag}
        onKeyDown={onResizeKey}
        {...stylex.props(styles.grip)}
      />
      <div {...stylex.props(styles.card)}>
        {state.tabs.length > 1 && (
          <div role="tablist" aria-label="Open files" {...stylex.props(styles.tabs)} style={{ paddingTop: 8 }}>
            {state.tabs.map((t) => (
              <div key={t.path} {...stylex.props(styles.chip, state.active === t.path && styles.chipActive)}>
                <button type="button" role="tab" aria-selected={state.active === t.path} onClick={() => actions.openFile(t.path)} onDoubleClick={() => actions.pinTab(t.path)} {...stylex.props(styles.chipLabel)}>
                  <Text type="supporting" maxLines={1}>{basename(t.path)}</Text>
                </button>
                <IconButton label={`Close ${basename(t.path)}`} variant="ghost" size="sm" icon={<Icon icon={XMarkIcon} size="sm" />} onClick={() => actions.closeTab(t.path)} />
              </div>
            ))}
          </div>
        )}
        {showingFiles ? (
          <>
            <div {...stylex.props(styles.header)}>
              <div {...stylex.props(styles.identity)}>
                <span {...stylex.props(styles.tile)}>
                  <Icon icon={FolderIcon} size="md" />
                </span>
                <div {...stylex.props(styles.titles)}>
                  <Text weight="medium">Files</Text>
                  <Text type="supporting" color="secondary">In this chat’s sandbox</Text>
                </div>
              </div>
              <div {...stylex.props(styles.actions)}>
                <IconButton label="Close preview" tooltip="Close" variant="ghost" size="sm" icon={<Icon icon={XMarkIcon} size="sm" />} onClick={actions.close} />
              </div>
            </div>
            <div {...stylex.props(styles.divider)} />
            <div {...stylex.props(styles.filesPage)}>
              <FileTree tree={tree} onOpen={actions.openFile} />
            </div>
          </>
        ) : (
          <FileView sessionId={sessionId} path={state.active} size={entries.find((e) => e.path === state.active)?.size} tree={tree} reloadKey={reloadKey} onMissing={load} />
        )}
      </div>
    </div>
  )
}
