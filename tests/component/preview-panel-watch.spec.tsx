// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { act, cleanup, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PreviewPanelProvider, usePreviewPanel } from '@/preview/store'
import { PreviewPanel } from '@/ui/preview/PreviewPanel'

const { listSessionArtifacts } = vi.hoisted(() => ({
  listSessionArtifacts: vi.fn(async () => ({ object: 'list', data: [{ path: 'a.txt', size: 1 }, { path: 'b.txt', size: 2 }] })),
}))

let watchChange: ((paths: string[] | 'reset') => void) | undefined
vi.mock('@/preview/use-file-watch', () => ({
  useFileWatch: (_id: string, _enabled: boolean, onChange: (paths: string[] | 'reset') => void) => {
    watchChange = onChange
  },
}))

vi.mock('@/api/client', () => ({
  api: { listSessionArtifacts, sessionChanges: vi.fn(async () => ({ object: 'list', data: [] })) },
  ApiError: class extends Error {},
}))

vi.mock('@/ui/terminal/Terminal', () => ({ Terminal: () => <div /> }))

let openFile: (p: string) => void = () => {}
function Probe() {
  openFile = usePreviewPanel().actions.openFile
  return null
}

describe('PreviewPanel workspace watch', () => {
  beforeEach(() => {
    watchChange = undefined
    listSessionArtifacts.mockClear()
    vi.useFakeTimers()
  })
  afterEach(() => {
    cleanup()
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('reloads the tree on changed paths and reloads the active file when it changed', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('hello')))
    render(
      <PreviewPanelProvider sessionId="s1">
        <Probe />
        <PreviewPanel sessionId="s1" idle />
      </PreviewPanelProvider>,
    )
    act(() => openFile('a.txt'))
    await act(async () => {})
    const callsBefore = listSessionArtifacts.mock.calls.length

    act(() => { watchChange?.(['a.txt']) })
    await act(async () => { vi.advanceTimersByTime(1000) })
    await act(async () => {})
    expect(listSessionArtifacts.mock.calls.length).toBeGreaterThan(callsBefore)
  })

  it('reloads on reset', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('hello')))
    render(
      <PreviewPanelProvider sessionId="s1">
        <Probe />
        <PreviewPanel sessionId="s1" idle />
      </PreviewPanelProvider>,
    )
    act(() => openFile('a.txt'))
    await act(async () => {})
    const callsBefore = listSessionArtifacts.mock.calls.length

    act(() => { watchChange?.('reset') })
    await act(async () => { vi.advanceTimersByTime(1000) })
    await act(async () => {})
    expect(listSessionArtifacts.mock.calls.length).toBeGreaterThan(callsBefore)
  })
})
