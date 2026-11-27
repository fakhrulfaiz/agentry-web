// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import '../helpers/dom'
import { act, cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
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
    expect(screen.getByTestId('browser-frame')).toHaveAttribute('src', '/api/agentry/agents/files/file_9/content')
    await userEvent.click(screen.getByRole('button', { name: /Pages visited \(2\)/ }))
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

class FakeSource {
  static all: FakeSource[] = []
  static CLOSED = 2
  readyState = 1
  listeners = new Map<string, (e: MessageEvent<string>) => void>()
  url: string
  constructor(url: string) { this.url = url; FakeSource.all.push(this) }
  addEventListener(name: string, fn: (e: MessageEvent<string>) => void) { this.listeners.set(name, fn) }
  close() { this.readyState = 2 }
  emit(name: string, data: unknown) { act(() => { this.listeners.get(name)?.({ data: JSON.stringify(data) } as MessageEvent<string>) }) }
}
const lastSource = () => FakeSource.all.at(-1)!

function openBrowserTab(browser: BrowserState) {
  render(<Panel browser={browser} />)
  act(() => controls!.openView('browser', 'Browser'))
}

describe('Browser tab live view', () => {
  beforeEach(() => {
    FakeSource.all = []
    vi.stubGlobal('EventSource', FakeSource)
  })
  afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers() })

  it('shows the live frames with the current page and a Live status', async () => {
    openBrowserTab(browsing)
    expect(lastSource().url).toBe('/api/agentry/agents/sessions/s1/browser/live')
    expect(screen.getByText('Not browsing')).toBeInTheDocument()
    lastSource().emit('frame', { data: '/9j/AA==', url: 'https://news.example.org/a', title: 'News', width: 1280, height: 720, timestamp: 1 })
    expect(screen.getByRole('img', { name: /live view/i })).toHaveAttribute('src', 'data:image/jpeg;base64,/9j/AA==')
    expect(screen.getByLabelText('Live')).toBeInTheDocument()
    const toolbar = screen.getByTestId('browser-toolbar')
    expect(toolbar).toHaveTextContent('news.example.org')
    expect(toolbar).toHaveTextContent('/a')
    expect(toolbar.querySelector('a')).toHaveAttribute('href', 'https://news.example.org/a')
    // The history is still there, behind its collapsed disclosure.
    await userEvent.click(screen.getByRole('button', { name: /Pages visited \(2\)/ }))
    expect(screen.getByRole('list', { name: 'Pages visited' })).toBeInTheDocument()
    // The browser closed: back to the last screenshot.
    lastSource().emit('idle', { reason: 'not_started' })
    expect(screen.getByTestId('browser-frame')).toHaveAttribute('src', '/api/agentry/agents/files/file_9/content')
    expect(screen.getByText('Not browsing')).toBeInTheDocument()
  })

  it('shows live frames even before any browser call is in the history', () => {
    openBrowserTab(EMPTY_BROWSER)
    expect(screen.getByText('No browsing yet')).toBeInTheDocument()
    lastSource().emit('frame', { data: 'AAA', url: 'about:blank', title: '' })
    expect(screen.getByRole('img', { name: /live view/i })).toBeInTheDocument()
  })

  it.each([
    ['not_sandbox', 'Only chats on a sandbox can use a browser', /Start a chat on a sandbox/],
    ['no_browser', 'This sandbox has no browser', /Start a new chat on an environment made from the Web and browser template\./],
    ['browser_off', 'The web browser is off for this agent', /Turn on Web browser in the agent's Tools\./],
  ])('says why the chat cannot browse: %s', (reason, title, description) => {
    openBrowserTab(EMPTY_BROWSER)
    lastSource().emit('idle', { reason })
    expect(screen.getByText(title)).toBeInTheDocument()
    expect(screen.getByText(description)).toBeInTheDocument()
    expect(screen.queryByText('No browsing yet')).not.toBeInTheDocument()
  })

  it('keeps saying "No browsing yet" while the browser has not started', () => {
    openBrowserTab(EMPTY_BROWSER)
    lastSource().emit('idle', { reason: 'not_started' })
    expect(screen.getByText('No browsing yet')).toBeInTheDocument()
  })

  it('stops the stream while the page is hidden and reopens it when shown', () => {
    openBrowserTab(browsing)
    const first = lastSource()
    const setHidden = (hidden: boolean) => {
      Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => (hidden ? 'hidden' : 'visible') })
      act(() => { document.dispatchEvent(new Event('visibilitychange')) })
    }
    setHidden(true)
    expect(first.readyState).toBe(2)
    setHidden(false)
    expect(FakeSource.all).toHaveLength(2)
    expect(lastSource().readyState).toBe(1)
  })

  it('shows at most one frame a second with reduced motion, ending on the newest', () => {
    vi.stubGlobal('matchMedia', (q: string) => ({ matches: q.includes('reduced-motion'), addEventListener() {}, removeEventListener() {} }))
    vi.useFakeTimers()
    openBrowserTab(browsing)
    lastSource().emit('frame', { data: 'ONE', url: 'https://e.com/', title: 'E' })
    lastSource().emit('frame', { data: 'TWO', url: 'https://e.com/', title: 'E' })
    lastSource().emit('frame', { data: 'THREE', url: 'https://e.com/', title: 'E' })
    const img = () => screen.getByRole('img', { name: /live view/i })
    expect(img()).toHaveAttribute('src', 'data:image/jpeg;base64,ONE')
    act(() => { vi.advanceTimersByTime(1000) })
    expect(img()).toHaveAttribute('src', 'data:image/jpeg;base64,THREE')
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
