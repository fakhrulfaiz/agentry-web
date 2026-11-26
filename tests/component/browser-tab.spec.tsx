// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import '../helpers/dom'
import { act, cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { EMPTY_BROWSER, type BrowserState } from '@/chat/browser-tools'
import { PanelConversationContext, type PanelConversation } from '@/chat/panel-data'
import { PreviewPanelProvider, usePreviewPanel } from '@/preview/store'
import { ToolCard } from '@/ui/chat/ToolCard'
import { BrowserAutoOpen } from '@/ui/preview/BrowserView'
import { PreviewPanel } from '@/ui/preview/PreviewPanel'

vi.mock('@/api/client', () => ({ api: { listSessionArtifacts: vi.fn(async () => ({ object: 'list', data: [] })) } }))

const base: PanelConversation = { tasks: [], subagentViews: [], todos: [], browser: EMPTY_BROWSER, items: new Map(), actions: new Map(), answer: async () => {} }
const browsing: BrowserState = {
  calls: 3,
  running: false,
  current: { url: 'https://www.iana.org/', title: 'IANA' },
  screenshot: { type: 'output_image', file_id: 'file_9', media_type: 'image/png', bytes: 10 },
  visited: [{ url: 'https://example.com/', title: 'Example Domain' }, { url: 'https://www.iana.org/', title: 'IANA' }],
}

let controls: ReturnType<typeof usePreviewPanel>['actions'] | null = null
function Controls() {
  controls = usePreviewPanel().actions
  return null
}

function Panel({ browser, loaded = true }: { browser: BrowserState; loaded?: boolean }) {
  return (
    <PreviewPanelProvider sessionId="s1">
      <PanelConversationContext.Provider value={{ ...base, browser }}>
        <Controls />
        <BrowserAutoOpen loaded={loaded} />
        <PreviewPanel sessionId="s1" idle />
      </PanelConversationContext.Provider>
    </PreviewPanelProvider>
  )
}

afterEach(cleanup)

describe('Browser tab', () => {
  it('opens from the Start page and says nothing was browsed yet', async () => {
    render(<Panel browser={EMPTY_BROWSER} />)
    act(() => controls!.showStart())
    await userEvent.click(await screen.findByRole('button', { name: /Browser/ }))
    expect(await screen.findByText('No browsing yet')).toBeInTheDocument()
  })

  it('opens by itself on a new browser call and shows the page, screenshot and history', async () => {
    const { rerender } = render(<Panel browser={EMPTY_BROWSER} />)
    expect(screen.queryByText('No browsing yet')).not.toBeInTheDocument()
    rerender(<Panel browser={browsing} />)
    const tab = await screen.findByTestId('browser-tab')
    expect(tab).toBeInTheDocument()
    expect(screen.getByRole('img', { name: /latest screenshot/i })).toHaveAttribute('src', '/api/agentry/agents/files/file_9/content')
    expect(screen.getByRole('list', { name: 'Pages visited' }).querySelectorAll('li')).toHaveLength(2)
    expect(screen.getAllByRole('link', { name: /IANA/ })[0]).toHaveAttribute('href', 'https://www.iana.org/')
  })

  it('does not open for browser calls already in the loaded history', () => {
    const { rerender } = render(<Panel browser={EMPTY_BROWSER} loaded={false} />)
    rerender(<Panel browser={browsing} loaded={false} />)
    rerender(<Panel browser={browsing} loaded />)
    expect(screen.queryByTestId('browser-tab')).not.toBeInTheDocument()
  })

})

describe('ToolCard for browser calls', () => {
  it('shows a readable title instead of the MCP name', () => {
    render(<ToolCard view={{ kind: 'tool', id: 't1', callId: 'c1', name: 'mcp__browser__browser_navigate', args: { url: 'https://example.com/' }, status: 'done', output: '- Page URL: https://example.com/' }} />)
    expect(screen.getByText('Opened example.com')).toBeInTheDocument()
    expect(screen.queryByText('mcp__browser__browser_navigate')).not.toBeInTheDocument()
  })

  it('shows the page a click left the browser on', async () => {
    render(<ToolCard view={{ kind: 'tool', id: 't2', callId: 'c2', name: 'mcp__browser__browser_click', args: { element: 'More information' }, status: 'done', output: '- Page URL: https://www.iana.org/help\n- Page Title: IANA' }} />)
    expect(screen.getByText('Clicked More information')).toBeInTheDocument()
    expect(screen.getByText('www.iana.org/help')).toBeInTheDocument()
  })
})
