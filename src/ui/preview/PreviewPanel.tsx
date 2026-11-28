'use client'

/**
 * The chat's right-hand preview panel, in the manner of claude.ai's artifact
 * panel: a floating card whose header carries the file's identity on the left
 * and, on the right, a Preview | Code switch with icon actions. The sandbox tree
 * opens beside the file from the folder icon. Resizable; Escape closes it.
 */
import { EmptyState } from '@astryxdesign/core/EmptyState'
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
  GlobeAltIcon,
  ListBulletIcon,
  UserGroupIcon,
  PhotoIcon,
  PlusIcon,
  CommandLineIcon,
  TableCellsIcon,
  XMarkIcon,
  HomeIcon,
  PencilSquareIcon,
  DocumentMagnifyingGlassIcon,
  ChevronRightIcon,
  FilmIcon,
  ComputerDesktopIcon,
} from '@heroicons/react/24/outline'
import * as stylex from '@stylexjs/stylex'
import { usePrefersReducedMotion } from '@/ui/chat/use-reduced-motion'
import { useCallback, useEffect, useMemo, useRef, useState, type ComponentType, type KeyboardEvent, type PointerEvent, type SVGProps } from 'react'
import { api } from '@/api/client'
import { type RendererId, renderersFor } from '@/preview/renderers'
import { MAX_WIDTH, MIN_WIDTH, usePreviewPanel } from '@/preview/store'
import { buildTree, type TreeNode } from '@/preview/tree'
import { fileUrl } from '@/preview/use-file-bytes'
import { useFileWatch } from '@/preview/use-file-watch'
import { Terminal } from '@/ui/terminal/Terminal'
import { usePanelConversation } from '@/chat/panel-data'
import { todoCount } from '@/chat/todos'
import { PlanTab, SubagentTab, TasksTab } from './PanelTabs'
import { BROWSER_TITLE, BROWSER_VIEW, BrowserTab } from './BrowserView'
import { JobTab } from './JobView'
import { PortPreview, PREVIEW_TITLE, PREVIEW_VIEW } from './PortPreview'
import { isLiveJob, parseJobViewKey } from '@/chat/jobs'
import { ChangesTab, DiffView, officeKind } from './ChangesPanel'
import { parseDiffKey } from '@/preview/diff'
import { FileTree } from './FileTree'
import { RendererBody } from './renderers'

const SLIDE_MS = '220ms'

const styles = stylex.create({
  // The slot slides the panel in and out by animating its width; the panel inside keeps its own width, so its content is clipped, not squeezed.
  slot: { flexShrink: 0, display: 'flex', minHeight: 0, overflow: 'hidden' },
  slotWidth: (width: number) => ({ width }),
  slotAnimated: { transitionProperty: 'width, visibility', transitionDuration: `${SLIDE_MS}, 0s`, transitionTimingFunction: 'ease, linear' },
  slotClosed: { visibility: 'hidden', transitionDelay: `0s, ${SLIDE_MS}` },
  shell: (width: number) => ({
    position: { default: 'relative', '@media (max-width: 767px)': 'fixed' },
    inset: { default: 'auto', '@media (max-width: 767px)': 0 },
    zIndex: { default: 'auto', '@media (max-width: 767px)': 20 },
    width: { default: width, '@media (max-width: 767px)': '100%' },
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
  strip: {
    display: 'flex',
    alignItems: 'stretch',
    flexShrink: 0,
    height: 40,
    borderBottomWidth: 1,
    borderBottomStyle: 'solid',
    borderBottomColor: colorVars['--color-border'],
  },
  tabs: {
    display: 'flex',
    alignItems: 'stretch',
    flex: 1,
    minWidth: 0,
    overflowX: 'auto',
    scrollbarWidth: 'none',
  },
  stripEnd: { display: 'flex', alignItems: 'center', paddingInline: 6, flexShrink: 0 },
  tab: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    flexShrink: 0,
    maxWidth: 200,
    paddingInlineStart: 12,
    paddingInlineEnd: 4,
    color: colorVars['--color-text-secondary'],
    borderBottomWidth: 2,
    borderBottomStyle: 'solid',
    borderBottomColor: 'transparent',
    backgroundColor: { default: 'transparent', ':hover': colorVars['--color-background-muted'] },
  },
  tabActive: { color: colorVars['--color-text-primary'], borderBottomColor: colorVars['--color-accent'] },
  tabHome: { paddingInlineEnd: 12 },
  tabLabel: {
    all: 'unset',
    cursor: 'pointer',
    minWidth: 0,
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    height: '100%',
    outlineStyle: { default: 'none', ':focus-visible': 'solid' },
    outlineWidth: 2,
    outlineOffset: -2,
    outlineColor: colorVars['--color-accent'],
  },
  divider: { height: 1, flexShrink: 0, backgroundColor: colorVars['--color-border'] },
  body: { flex: 1, minHeight: 0, display: 'flex' },
  tree: { width: 232, flexShrink: 0, overflow: 'auto', borderInlineEnd: `1px solid ${colorVars['--color-border']}` },
  content: { flex: 1, minWidth: 0, position: 'relative', overflow: 'auto' },
  filesPage: { flex: 1, minWidth: 0, overflow: 'auto', padding: 8 },
  // The Browser tab sizes its viewport to the page, so the page neither scrolls nor grows.
  fillPage: { display: 'flex', flexDirection: 'column', minHeight: 0, overflow: 'hidden' },
  startPage: { flex: 1, minHeight: 0, overflow: 'auto', display: 'flex', flexDirection: 'column', gap: 20, padding: '20px 12px' },
  startSection: { display: 'flex', flexDirection: 'column', gap: 2 },
  startHeading: { paddingInline: 8, paddingBottom: 4 },
  startRow: {
    all: 'unset',
    boxSizing: 'border-box',
    textAlign: 'start',
    display: 'flex',
    alignItems: 'center',
    gap: 12,
    padding: '10px 8px',
    cursor: 'pointer',
    borderRadius: radiusVars['--radius-element'],
    color: colorVars['--color-text-primary'],
    backgroundColor: { default: 'transparent', ':hover': colorVars['--color-background-muted'] },
    outlineStyle: { default: 'none', ':focus-visible': 'solid' },
    outlineWidth: 2,
    outlineColor: colorVars['--color-accent'],
  },
  startRowOff: { cursor: 'default', opacity: 0.55, backgroundColor: 'transparent' },
  startIcon: { flexShrink: 0, color: colorVars['--color-text-secondary'], display: 'flex' },
  startText: { flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', alignItems: 'flex-start', textAlign: 'start' },
  startStatus: { flexShrink: 0, maxWidth: 160, display: 'flex', alignItems: 'center', gap: 4, color: colorVars['--color-text-secondary'] },
  termPane: { flex: 1, minHeight: 0, flexDirection: 'column' },
})

type IconType = ComponentType<SVGProps<SVGSVGElement>>

const basename = (path: string) => path.split('/').pop() ?? path
const extOf = (path: string) => path.slice(path.lastIndexOf('.') + 1).toUpperCase()

/** Preview-side renderers vs code-side ones, for the two-way header switch. */
const SIDE: Record<RendererId, 'preview' | 'code'> = {
  markdown: 'preview', html: 'preview', table: 'preview', json: 'preview', image: 'preview', video: 'preview', pdf: 'preview', officePdf: 'preview', sheet: 'preview', download: 'preview',
  code: 'code', source: 'code', text: 'code', docx: 'code',
}
const TEXT_LIKE = new Set<RendererId>(['markdown', 'html', 'table', 'json', 'code', 'source', 'text'])

function kindOf(path: string, id: RendererId): { label: string; icon: IconType } {
  if (id === 'image') return { label: 'Image', icon: PhotoIcon }
  if (id === 'video') return { label: 'Video', icon: FilmIcon }
  if (id === 'pdf') return { label: 'PDF', icon: DocumentIcon }
  if (id === 'officePdf') return officeKind(path)
  if (id === 'sheet') return { label: 'Spreadsheet', icon: TableCellsIcon }
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
              <ToggleButton value="code" label={codeId === 'docx' ? 'Text' : 'Code'} />
            </ToggleButtonGroup>
          )}
          <IconButton label={copied ? 'Copied' : 'Copy'} tooltip={copied ? 'Copied' : 'Copy'} variant="ghost" size="sm" icon={<Icon icon={copied ? CheckIcon : ClipboardDocumentIcon} size="sm" />} onClick={() => void copy()} />
          <IconButton label="Download" tooltip="Download" variant="ghost" size="sm" href={fileUrl(sessionId, path, true)} icon={<Icon icon={ArrowDownTrayIcon} size="sm" />} />
          <IconButton label="Files" tooltip="Files" variant="ghost" size="sm" icon={<Icon icon={FolderIcon} size="sm" />} onClick={actions.toggleTree} />
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

function StartRow({
  icon, title, description, status, onOpen, disabled,
}: { icon: IconType; title: string; description: string; status?: string; onOpen(): void; disabled?: boolean }) {
  return (
    <button type="button" aria-disabled={disabled} onClick={disabled ? undefined : onOpen} {...stylex.props(styles.startRow, disabled && styles.startRowOff)}>
      <span {...stylex.props(styles.startIcon)}><Icon icon={icon} size="md" /></span>
      <span {...stylex.props(styles.startText)}>
        <Text weight="medium">{title}</Text>
        <Text type="supporting" color="secondary" maxLines={1}>{description}</Text>
      </span>
      {status && (
        <span {...stylex.props(styles.startStatus)}>
          <Text type="supporting" color="secondary" maxLines={1}>{status}</Text>
        </span>
      )}
      {!disabled && <span {...stylex.props(styles.startIcon)}><Icon icon={ChevronRightIcon} size="sm" /></span>}
    </button>
  )
}

const plural = (n: number, one: string, many = `${one}s`) => `${String(n)} ${n === 1 ? one : many}`
const hostOf = (url: string) => {
  try {
    return new URL(url).host || url
  } catch {
    return url
  }
}

/** The panel's home: what this chat's workspace holds, each row with its live status. */
function StartPage({ canTerminal, fileCount }: { canTerminal: boolean; fileCount: number }) {
  const { state, actions } = usePreviewPanel()
  const { tasks, todos, browser, jobs } = usePanelConversation()
  const running = tasks.filter((t) => t.status === 'running').length + jobs.filter(isLiveJob).length
  const waiting = tasks.reduce((n, t) => n + t.waiting, 0)
  const count = todoCount(todos)
  const finished = tasks.length + jobs.length
  const taskStatus = waiting > 0 ? `${plural(waiting, 'approval')} waiting` : running > 0 ? `${String(running)} running` : finished > 0 ? `${String(finished)} finished` : undefined
  return (
    <div {...stylex.props(styles.startPage)} data-testid="preview-start">
      <div {...stylex.props(styles.startSection)}>
        <span {...stylex.props(styles.startHeading)}><Text type="supporting" weight="medium" color="secondary">Workspace</Text></span>
        <StartRow icon={FolderIcon} title="Files" description="Everything in this chat’s workspace" status={fileCount > 0 ? plural(fileCount, 'file') : undefined} onOpen={actions.showFiles} />
        <StartRow
          icon={CommandLineIcon}
          title="Terminal"
          description={canTerminal ? 'A shell in this chat’s sandbox' : 'Only chats that run in a sandbox have a terminal'}
          status={canTerminal && state.terminals.length > 0 ? `${String(state.terminals.length)} open` : undefined}
          onOpen={actions.openTerminal}
          disabled={!canTerminal}
        />
        <StartRow
          icon={ComputerDesktopIcon}
          title="Preview"
          description={canTerminal ? 'An app running in this chat’s sandbox' : 'Only chats that run in a sandbox can preview an app'}
          onOpen={() => actions.openView(PREVIEW_VIEW, PREVIEW_TITLE)}
          disabled={!canTerminal}
        />
        <StartRow
          icon={GlobeAltIcon}
          title="Browser"
          description="Pages the agent’s web browser visited"
          status={browser.running ? 'Browsing…' : browser.current ? hostOf(browser.current.url) : undefined}
          onOpen={() => actions.openView(BROWSER_VIEW, BROWSER_TITLE)}
        />
      </div>
      <div {...stylex.props(styles.startSection)}>
        <span {...stylex.props(styles.startHeading)}><Text type="supporting" weight="medium" color="secondary">This chat</Text></span>
        <StartRow icon={UserGroupIcon} title="Tasks" description="Subagents and background commands" status={taskStatus} onOpen={() => actions.openView('tasks', 'Tasks')} />
        <StartRow icon={ListBulletIcon} title="Plan" description="The agent’s to-do list" status={count ? `${count} done` : undefined} onOpen={() => actions.openView('plan', 'Plan')} />
        <StartRow icon={PencilSquareIcon} title="Changes" description="Files each turn changed, with diffs" onOpen={() => actions.openView('changes', 'Changes')} />
      </div>
    </div>
  )
}

/** The icon a tab shows, by what it holds. */
function viewIcon(key: string): IconType {
  if (key === 'tasks' || key.startsWith('sub:')) return UserGroupIcon
  if (parseJobViewKey(key) !== null) return CommandLineIcon
  if (key === 'plan') return ListBulletIcon
  if (key === 'changes') return PencilSquareIcon
  if (key.startsWith('diff:')) return DocumentMagnifyingGlassIcon
  if (key === BROWSER_VIEW) return GlobeAltIcon
  if (key === PREVIEW_VIEW) return ComputerDesktopIcon
  return DocumentIcon
}

function Tab({
  icon, label, active, onSelect, onClose, home, onDoubleClick,
}: { icon: IconType; label: string; active: boolean; onSelect(): void; onClose?: () => void; home?: boolean; onDoubleClick?: () => void }) {
  return (
    <div {...stylex.props(styles.tab, active && styles.tabActive, home && styles.tabHome)}>
      <button type="button" role="tab" aria-selected={active} aria-label={home ? label : undefined} title={label} onClick={onSelect} onDoubleClick={onDoubleClick} {...stylex.props(styles.tabLabel)}>
        <Icon icon={icon} size="sm" />
        {!home && <Text type="supporting" weight={active ? 'medium' : undefined} maxLines={1}>{label}</Text>}
      </button>
      {onClose && <IconButton label={`Close ${label}`} variant="ghost" size="sm" icon={<Icon icon={XMarkIcon} size="sm" />} onClick={onClose} />}
    </div>
  )
}

export function PreviewPanel({ sessionId, idle, environmentId }: { sessionId: string; idle: boolean; environmentId?: string }) {
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
  const activeRef = useRef(state.active)
  activeRef.current = state.active
  const watchTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  useEffect(() => () => { clearTimeout(watchTimer.current) }, [])
  useFileWatch(sessionId, state.open, (paths) => {
    clearTimeout(watchTimer.current)
    watchTimer.current = setTimeout(() => {
      load()
      if (paths === 'reset' || paths.includes(activeRef.current)) setReloadKey((k) => k + 1)
    }, 1000)
  })
  const tree = useMemo(() => buildTree(entries), [entries])

  const reducedMotion = usePrefersReducedMotion()
  // Mounted from the first open on (so terminals keep running while the panel is closed); `shown` lags one frame so the first open slides too.
  const [mounted, setMounted] = useState(false)
  const [shown, setShown] = useState(false)
  useEffect(() => {
    if (!state.open) return setShown(false)
    setMounted(true)
    const frame = requestAnimationFrame(() => setShown(true))
    return () => cancelAnimationFrame(frame)
  }, [state.open])
  if (!mounted) return null
  const onKey = (e: KeyboardEvent) => {
    // Escape inside a terminal belongs to the program running there (vim, less, ...).
    if (e.key === 'Escape' && !(e.target as HTMLElement).closest('[data-testid="terminal-host"]')) actions.close()
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
  const onTerminal = state.active.startsWith('term:')
  const activeView = state.views.find((v) => `view:${v.key}` === state.active)
  return (
    <div
      data-testid="preview-slot"
      aria-hidden={!state.open}
      inert={!state.open}
      {...stylex.props(styles.slot, styles.slotWidth(shown && state.open ? state.width : 0), !reducedMotion && styles.slotAnimated, !state.open && styles.slotClosed)}
    >
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
        <div {...stylex.props(styles.strip)}>
          <div role="tablist" aria-label="Open tabs" {...stylex.props(styles.tabs)}>
            <Tab icon={HomeIcon} label="Start" home active={state.active === 'start'} onSelect={actions.showStart} />
            {state.filesOpen && <Tab icon={FolderIcon} label="Files" active={showingFiles} onSelect={actions.showFiles} onClose={actions.closeFiles} />}
            {state.tabs.map((t) => (
              <Tab key={t.path} icon={kindOf(t.path, renderersFor(basename(t.path)).default).icon} label={basename(t.path)} active={state.active === t.path} onSelect={() => actions.openFile(t.path)} onDoubleClick={() => actions.pinTab(t.path)} onClose={() => actions.closeTab(t.path)} />
            ))}
            {state.terminals.map((t) => (
              <Tab key={t.key} icon={CommandLineIcon} label={t.title} active={state.active === `term:${t.key}`} onSelect={() => actions.selectTerminal(t.key)} onClose={() => actions.closeTerminal(t.key)} />
            ))}
            {state.views.map((v) => (
              <Tab key={v.key} icon={viewIcon(v.key)} label={v.title} active={state.active === `view:${v.key}`} onSelect={() => actions.openView(v.key, v.title)} onClose={() => actions.closeView(v.key)} />
            ))}
          </div>
          <div {...stylex.props(styles.stripEnd)}>
            {onTerminal && <IconButton label="New terminal" tooltip="New terminal" variant="ghost" size="sm" icon={<Icon icon={PlusIcon} size="sm" />} onClick={actions.openTerminal} />}
            <IconButton label="Close panel" tooltip="Close panel" variant="ghost" size="sm" icon={<Icon icon={XMarkIcon} size="sm" />} onClick={actions.close} />
          </div>
        </div>
        {state.active === 'start' ? (
          <StartPage canTerminal={environmentId !== undefined} fileCount={entries.length} />
        ) : activeView ? (
          <div {...stylex.props(styles.filesPage, (activeView.key === BROWSER_VIEW || activeView.key === PREVIEW_VIEW) && styles.fillPage)}>
            {activeView.key === 'changes' ? <ChangesTab sessionId={sessionId} /> : parseDiffKey(activeView.key) ? <DiffView sessionId={sessionId} {...parseDiffKey(activeView.key)!} /> : activeView.key === 'tasks' ? <TasksTab /> : activeView.key === 'plan' ? <PlanTab /> : activeView.key === BROWSER_VIEW ? <BrowserTab sessionId={sessionId} /> : activeView.key === PREVIEW_VIEW && environmentId !== undefined ? <PortPreview environmentId={environmentId} /> : parseJobViewKey(activeView.key) !== null ? <JobTab key={activeView.key} sessionId={sessionId} jobId={parseJobViewKey(activeView.key)!} /> : <SubagentTab subagentId={activeView.key.slice(4)} />}
          </div>
        ) : onTerminal ? null : showingFiles ? (
          <div {...stylex.props(styles.filesPage)}>
            {tree.length === 0 ? <EmptyState title="No files yet" description="Files the agent writes in this chat’s workspace appear here." headingLevel={2} /> : <FileTree tree={tree} onOpen={actions.openFile} />}
          </div>
        ) : (
          <FileView sessionId={sessionId} path={state.active} size={entries.find((e) => e.path === state.active)?.size} tree={tree} reloadKey={reloadKey} onMissing={load} />
        )}
        {environmentId !== undefined && state.terminals.map((t) => (
          // Every terminal stays mounted so its shell survives switching tabs; closing the tab closes the shell.
          <div key={t.key} role="tabpanel" aria-label={t.title} {...stylex.props(styles.termPane)} style={{ display: state.active === `term:${t.key}` ? 'flex' : 'none' }}>
            <Terminal environmentId={environmentId} variant="pane" />
          </div>
        ))}
      </div>
    </div>
    </div>
  )
}
