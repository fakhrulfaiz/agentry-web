'use client'

/**
 * The chat's right-hand preview panel: a Files tab (the sandbox tree) plus one
 * tab per opened file, with a header (renderer, wrap, scripts, reload, copy,
 * download) and an optional tree beside the file. Resizable; Escape closes it.
 */
import { Button } from '@astryxdesign/core/Button'
import { HStack } from '@astryxdesign/core/HStack'
import { Text } from '@astryxdesign/core/Text'
import { ToggleButton } from '@astryxdesign/core/ToggleButton'
import { VStack } from '@astryxdesign/core/VStack'
import { useCallback, useEffect, useMemo, useState, type KeyboardEvent, type PointerEvent } from 'react'
import { api } from '@/api/client'
import { type RendererId, renderersFor } from '@/preview/renderers'
import { MAX_WIDTH, MIN_WIDTH, usePreviewPanel } from '@/preview/store'
import { buildTree, type TreeNode } from '@/preview/tree'
import { fileUrl } from '@/preview/use-file-bytes'
import { FileTree } from './FileTree'
import { RendererBody } from './renderers'

const RENDERER_LABEL: Record<RendererId, string> = {
  markdown: 'Rendered', code: 'Code', text: 'Text', image: 'Image', pdf: 'PDF', html: 'Preview',
  source: 'Source', table: 'Table', json: 'JSON', download: 'Download',
}
const TEXT_RENDERERS = new Set<RendererId>(['code', 'text', 'source'])
const basename = (path: string) => path.split('/').pop() ?? path

function FileView({ sessionId, path, tree, onMissing }: { sessionId: string; path: string; tree: TreeNode[]; onMissing(): void }) {
  const { state, actions } = usePreviewPanel()
  const choices = useMemo(() => renderersFor(basename(path)), [path])
  const [chosen, setChosen] = useState<RendererId | null>(null)
  const [wrap, setWrap] = useState(true)
  const [runScripts, setRunScripts] = useState(false)
  const [reloadKey, setReloadKey] = useState(0)
  useEffect(() => {
    setChosen(null)
    setRunScripts(false)
  }, [path])
  const id = chosen ?? choices.default
  const dirs = path.split('/').slice(0, -1).join('/')
  return (
    <VStack gap={0}>
      <HStack gap={2} vAlign="center" wrap="wrap">
        <Text type="supporting" color="secondary" maxLines={1}>{dirs ? `${dirs}/` : ''}</Text>
        <Text weight="medium" maxLines={1}>{basename(path)}</Text>
      </HStack>
      <HStack gap={1} vAlign="center" wrap="wrap">
        {choices.options.length > 1 &&
          choices.options.map((o) => (
            <ToggleButton key={o} label={RENDERER_LABEL[o]} size="sm" isPressed={o === id} onPressedChange={() => setChosen(o)} />
          ))}
        {TEXT_RENDERERS.has(id) && <ToggleButton label="Wrap" size="sm" isPressed={wrap} onPressedChange={setWrap} />}
        {id === 'html' && <ToggleButton label="Run scripts" size="sm" tooltip="Allow the page's scripts; it still cannot reach this app." isPressed={runScripts} onPressedChange={setRunScripts} />}
        <Button label="Reload" size="sm" variant="ghost" onClick={() => setReloadKey((k) => k + 1)} />
        <Button label="Copy path" size="sm" variant="ghost" onClick={() => void navigator.clipboard?.writeText(path)} />
        <Button label="Download" size="sm" variant="ghost" href={fileUrl(sessionId, path, true)} />
        <ToggleButton label="Tree" size="sm" isPressed={state.treeVisible} onPressedChange={actions.toggleTree} />
      </HStack>
      <HStack gap={0}>
        {state.treeVisible && (
          <div style={{ width: 220, flex: 'none', overflow: 'auto', maxHeight: '70vh' }}>
            <FileTree tree={tree} current={path} onOpen={actions.openFile} />
          </div>
        )}
        <div style={{ flex: 1, minWidth: 0, height: '70vh' }}>
          <RendererBody id={id} sessionId={sessionId} path={path} reloadKey={reloadKey} wrap={wrap} runScripts={runScripts} onMissing={onMissing} onRetry={() => setReloadKey((k) => k + 1)} />
        </div>
      </HStack>
    </VStack>
  )
}

export function PreviewPanel({ sessionId, idle }: { sessionId: string; idle: boolean }) {
  const { state, actions } = usePreviewPanel()
  const [entries, setEntries] = useState<{ path: string; size?: number }[]>([])
  const load = useCallback(() => {
    api.listSessionArtifacts(sessionId).then((l) => setEntries(l.data), () => setEntries([]))
  }, [sessionId])
  useEffect(() => {
    // Files change only while a turn runs; refresh on every return to idle and when the panel opens.
    if (state.open && idle) load()
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
  return (
    <HStack gap={0} data-testid="preview-panel" onKeyDown={onKey} style={{ width: state.width, flex: 'none', minHeight: 0, borderLeft: '1px solid var(--border, rgba(128,128,128,.3))' }}>
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
        style={{ width: 6, flex: 'none', cursor: 'col-resize' }}
      />
      <VStack gap={2} style={{ flex: 1, minWidth: 0, overflow: 'auto', padding: 8 }}>
        <HStack gap={1} vAlign="center" wrap="wrap" role="tablist" aria-label="Preview tabs">
          <ToggleButton label="Files" size="sm" isPressed={state.active === 'files'} onPressedChange={actions.showFiles} />
          {state.tabs.map((t) => (
            <HStack key={t.path} gap={0} vAlign="center">
              <ToggleButton label={basename(t.path)} size="sm" isPressed={state.active === t.path} onPressedChange={() => actions.openFile(t.path)} />
              {!t.pinned && <Button label={`Keep ${basename(t.path)} open`} isIconOnly icon={<span aria-hidden>📌</span>} size="sm" variant="ghost" onClick={() => actions.pinTab(t.path)} />}
              <Button label={`Close ${basename(t.path)}`} isIconOnly icon={<span aria-hidden>×</span>} size="sm" variant="ghost" onClick={() => actions.closeTab(t.path)} />
            </HStack>
          ))}
          <Button label="Close preview" size="sm" variant="ghost" onClick={actions.close} />
        </HStack>
        {state.active === 'files' ? (
          <>
            <HStack hAlign="end">
              <Button label="Reload" size="sm" variant="ghost" onClick={load} />
            </HStack>
            <FileTree tree={tree} onOpen={actions.openFile} />
          </>
        ) : (
          <FileView sessionId={sessionId} path={state.active} tree={tree} onMissing={load} />
        )}
      </VStack>
    </HStack>
  )
}
