// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { PreviewPanelProvider, usePreviewPanel } from '@/preview/store'
import { PreviewPanel } from '@/ui/preview/PreviewPanel'

vi.mock('@/api/client', () => ({
  api: { listSessionArtifacts: vi.fn(async () => ({ object: 'list', data: [{ path: 'a.md' }, { path: 'b.py' }] })) },
}))

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

let open: (p: string) => void = () => {}
function Probe() {
  open = usePreviewPanel().actions.openFile
  return null
}

describe('PreviewPanel', () => {
  it('opens a file tab, replaces the unpinned one, and closes on Escape', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('hello')))
    render(
      <PreviewPanelProvider sessionId="s1">
        <Probe />
        <PreviewPanel sessionId="s1" idle />
      </PreviewPanelProvider>,
    )
    expect(screen.queryByTestId('preview-panel')).not.toBeInTheDocument()
    act(() => open('a.md'))
    await screen.findByText('a.md')
    act(() => open('b.py'))
    await screen.findByText('b.py')
    expect(screen.queryByText('a.md')).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Close preview' }))
    await waitFor(() => expect(screen.queryByTestId('preview-panel')).not.toBeInTheDocument())
    act(() => open('b.py'))
    await screen.findByText('b.py')
    screen.getByRole('button', { name: 'Copy' }).focus()
    await userEvent.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByTestId('preview-panel')).not.toBeInTheDocument())
  })
})
