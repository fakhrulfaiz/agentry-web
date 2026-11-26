'use client'

/** State of the chat's right-hand preview panel: pure reducers plus a per-session React provider. */
import { createElement, createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'

export interface PanelState {
  open: boolean
  tabs: { path: string; pinned: boolean }[]
  /** Terminal tabs (sandbox chats); each `key` is local to this panel. */
  terminals: { key: string; title: string }[]
  termCount: number
  /** Tabs that are not files or terminals (Tasks, Plan, a subagent): `key` is `tasks`, `plan` or `sub:<id>`; active is `view:<key>`. */
  views: { key: string; title: string }[]
  /** `'start'` (the chooser), `'files'` (the tree), `term:<key>`, or an open file's path. */
  active: string
  treeVisible: boolean
  width: number
}

export const MIN_WIDTH = 320
export const MAX_WIDTH = 900
const DEFAULT_WIDTH = 560
const WIDTH_KEY = 'agentry-preview-width'

export const initialState = (): PanelState => ({ open: false, tabs: [], terminals: [], termCount: 0, views: [], active: 'start', treeVisible: false, width: DEFAULT_WIDTH })

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

export const showStart = (s: PanelState): PanelState => ({ ...s, open: true, active: 'start' })

export function openTerminal(s: PanelState): PanelState {
  const n = s.termCount + 1
  const key = `t${String(n)}`
  return { ...s, open: true, terminals: [...s.terminals, { key, title: `Terminal ${String(n)}` }], termCount: n, active: `term:${key}` }
}

export const selectTerminal = (s: PanelState, key: string): PanelState => ({ ...s, open: true, active: `term:${key}` })

export function closeTerminal(s: PanelState, key: string): PanelState {
  const terminals = s.terminals.filter((t) => t.key !== key)
  return { ...s, terminals, active: s.active === `term:${key}` ? 'start' : s.active }
}

export function openView(s: PanelState, key: string, title: string): PanelState {
  const views = s.views.some((v) => v.key === key) ? s.views.map((v) => (v.key === key ? { key, title } : v)) : [...s.views, { key, title }]
  return { ...s, open: true, views, active: `view:${key}` }
}

export function closeView(s: PanelState, key: string): PanelState {
  return { ...s, views: s.views.filter((v) => v.key !== key), active: s.active === `view:${key}` ? 'start' : s.active }
}

export const togglePanel = (s: PanelState): PanelState => ({ ...s, open: !s.open })
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
  showStart(): void
  toggle(): void
  openTerminal(): void
  closeTerminal(key: string): void
  selectTerminal(key: string): void
  openView(key: string, title: string): void
  closeView(key: string): void
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
      showStart: () => setState(showStart),
      toggle: () => setState(togglePanel),
      openTerminal: () => setState(openTerminal),
      closeTerminal: (key) => setState((s) => closeTerminal(s, key)),
      selectTerminal: (key) => setState((s) => selectTerminal(s, key)),
      openView: (key, title) => setState((s) => openView(s, key, title)),
      closeView: (key) => setState((s) => closeView(s, key)),
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
      actions: { openFile: noop, pinTab: noop, closeTab: noop, showFiles: noop, showStart: noop, toggle: noop, openTerminal: noop, closeTerminal: noop, selectTerminal: noop, openView: noop, closeView: noop, toggleTree: noop, close: noop, setWidth: noop },
    }
  )
}
