// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { PreviewPanelProvider, usePreviewPanel } from '@/preview/store'
import { PreviewPanel } from '@/ui/preview/PreviewPanel'

vi.mock('@/api/client', () => ({
  api: {
    listSessionArtifacts: vi.fn(async () => ({ object: 'list', data: [{ path: 'a.md' }, { path: 'b.py' }] })),
    sessionChanges: vi.fn(async () => ({ object: 'list', data: [] })),
  },
  ApiError: class extends Error {},
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
    await waitFor(() => expect(screen.getByTestId('preview-slot')).toHaveAttribute('inert'))
    act(() => open('b.py'))
    await screen.findByText('b.py')
    screen.getByRole('button', { name: 'Copy' }).focus()
    await userEvent.keyboard('{Escape}')
    await waitFor(() => expect(screen.getByTestId('preview-slot')).toHaveAttribute('inert'))
  })
})

vi.mock('@/ui/terminal/Terminal', () => ({
  Terminal: ({ environmentId }: { environmentId: string }) => <div data-testid="fake-terminal">{environmentId}</div>,
}))

let controls: ReturnType<typeof usePreviewPanel>['actions'] | null = null
function Controls() {
  controls = usePreviewPanel().actions
  return null
}

describe('PreviewPanel start page and terminals', () => {
  it('offers workspace files, and a terminal only in sandbox chats; terminals are tabs that stay mounted', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('hello')))
    const { rerender } = render(
      <PreviewPanelProvider sessionId="s1">
        <Controls />
        <PreviewPanel sessionId="s1" idle />
      </PreviewPanelProvider>,
    )
    act(() => controls!.showStart())
    expect(await screen.findByText('Only chats that run in a sandbox have a terminal')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Workspace files/ })).toBeInTheDocument()
    rerender(
      <PreviewPanelProvider sessionId="s1">
        <Controls />
        <PreviewPanel sessionId="s1" idle environmentId="env_1" />
      </PreviewPanelProvider>,
    )
    await userEvent.click(screen.getByRole('button', { name: /New terminal/ }))
    expect(await screen.findByTestId('fake-terminal')).toHaveTextContent('env_1')
    act(() => controls!.openTerminal())
    const tabs = await screen.findAllByRole('tab')
    expect(tabs.map((t) => t.textContent)).toEqual(['Terminal 1', 'Terminal 2'])
    expect(screen.getAllByTestId('fake-terminal')).toHaveLength(2)
    await userEvent.click(screen.getByRole('tab', { name: 'Terminal 1' }))
    expect(screen.getAllByTestId('fake-terminal')).toHaveLength(2)
    await userEvent.click(screen.getByRole('button', { name: 'Close Terminal 1' }))
    expect(screen.getAllByTestId('fake-terminal')).toHaveLength(1)
  })

  it('opens the Changes tab from the Start page, and says changes are kept until a restart', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('hello')))
    render(
      <PreviewPanelProvider sessionId="s1">
        <Controls />
        <PreviewPanel sessionId="s1" idle />
      </PreviewPanelProvider>,
    )
    act(() => controls!.showStart())
    await userEvent.click(await screen.findByRole('button', { name: /Changes/ }))
    expect(await screen.findByText('No changes yet')).toBeInTheDocument()
    expect(screen.getAllByText(/kept until the server restarts/).length).toBeGreaterThan(0)
  })
})
