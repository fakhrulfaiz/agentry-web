'use client'

/** State of the chat's right-hand preview panel: pure reducers plus a per-session React provider. */
import { createElement, createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'

export interface PanelState {
  open: boolean
  tabs: { path: string; pinned: boolean }[]
  /** `'files'` (the tree) or an open file's path. */
  active: string
  treeVisible: boolean
  width: number
}

export const MIN_WIDTH = 320
export const MAX_WIDTH = 900
const DEFAULT_WIDTH = 480
const WIDTH_KEY = 'agentry-preview-width'

export const initialState = (): PanelState => ({ open: false, tabs: [], active: 'files', treeVisible: false, width: DEFAULT_WIDTH })

export function openFile(s: PanelState, path: string): PanelState {
  const existing = s.tabs.find((t) => t.path === path)
  if (existing) return { ...s, open: true, active: path }
  const unpinned = s.tabs.findIndex((t) => !t.pinned)
  const tabs = [...s.tabs]
  if (unpinned >= 0) tabs[unpinned] = { path, pinned: false }
  else tabs.push({ path, pinned: false })
  return { ...s, open: true, tabs, active: path }
}

export const pinTab = (s: PanelState, path: string): PanelState => ({
  ...s,
  tabs: s.tabs.map((t) => (t.path === path ? { ...t, pinned: true } : t)),
})

export function closeTab(s: PanelState, path: string): PanelState {
  const tabs = s.tabs.filter((t) => t.path !== path)
  return { ...s, tabs, active: s.active === path ? 'files' : s.active }
}

export const showFiles = (s: PanelState): PanelState => ({ ...s, open: true, active: 'files' })
export const toggleTree = (s: PanelState): PanelState => ({ ...s, treeVisible: !s.treeVisible })
export const closePanel = (s: PanelState): PanelState => ({ ...s, open: false })
export const setWidth = (s: PanelState, px: number): PanelState => ({ ...s, width: Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, Math.round(px))) })

function savedWidth(): number {
  try {
    const n = Number(localStorage.getItem(WIDTH_KEY))
    return Number.isFinite(n) && n > 0 ? Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, n)) : DEFAULT_WIDTH
  } catch {
    return DEFAULT_WIDTH
  }
}

export interface PanelActions {
  openFile(path: string): void
  pinTab(path: string): void
  closeTab(path: string): void
  showFiles(): void
  toggleTree(): void
  close(): void
  setWidth(px: number): void
}

const Ctx = createContext<{ state: PanelState; actions: PanelActions } | null>(null)

/** Provides the panel state for one session; the state resets when `sessionId` changes. */
export function PreviewPanelProvider({ sessionId, children }: { sessionId: string | null; children: ReactNode }) {
  const [state, setState] = useState<PanelState>(initialState)
  useEffect(() => {
    setState({ ...initialState(), width: savedWidth() })
  }, [sessionId])
  const actions = useMemo<PanelActions>(
    () => ({
      openFile: (p) => setState((s) => openFile(s, p)),
      pinTab: (p) => setState((s) => pinTab(s, p)),
      closeTab: (p) => setState((s) => closeTab(s, p)),
      showFiles: () => setState(showFiles),
      toggleTree: () => setState(toggleTree),
      close: () => setState(closePanel),
      setWidth: (px) =>
        setState((s) => {
          const next = setWidth(s, px)
          try {
            localStorage.setItem(WIDTH_KEY, String(next.width))
          } catch {}
          return next
        }),
    }),
    [],
  )
  const value = useMemo(() => ({ state, actions }), [state, actions])
  return createElement(Ctx.Provider, { value }, children)
}

/** The panel's state and actions; a no-op default outside a provider so cards can render anywhere. */
export function usePreviewPanel(): { state: PanelState; actions: PanelActions } {
  const ctx = useContext(Ctx)
  const noop = useCallback(() => {}, [])
  return (
    ctx ?? {
      state: initialState(),
      actions: { openFile: noop, pinTab: noop, closeTab: noop, showFiles: noop, toggleTree: noop, close: noop, setWidth: noop },
    }
  )
}
