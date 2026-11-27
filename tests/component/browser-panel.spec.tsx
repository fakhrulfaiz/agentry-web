// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import '../helpers/dom'
import { act, cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { EMPTY_BROWSER } from '@/chat/browser-tools'
import { PanelConversationContext, type PanelConversation } from '@/chat/panel-data'
import { BrowserTab } from '@/ui/preview/BrowserView'

const calls = vi.hoisted(() => ({ take: vi.fn(), release: vi.fn(), input: vi.fn() }))
vi.mock('@/api/client', () => {
  class ApiError extends Error {
    constructor(readonly status: number, readonly code: string, message: string) { super(message) }
  }
  return {
    ApiError,
    api: { takeBrowserControl: calls.take, releaseBrowserControl: calls.release, browserInput: calls.input },
  }
})

class FakeSource {
  static all: FakeSource[] = []
  listeners = new Map<string, (e: MessageEvent<string>) => void>()
  constructor(readonly url: string) { FakeSource.all.push(this) }
  addEventListener(name: string, fn: (e: MessageEvent<string>) => void) { this.listeners.set(name, fn) }
  close() {}
  emit(name: string, data: unknown) { act(() => { this.listeners.get(name)?.({ data: JSON.stringify(data) } as MessageEvent<string>) }) }
}
const source = () => FakeSource.all.at(-1)!

function panel(visited: PanelConversation['browser']['visited'] = []): PanelConversation {
  return { tasks: [], subagentViews: [], todos: [], browser: { ...EMPTY_BROWSER, calls: 1, visited }, items: new Map(), actions: new Map(), answer: async () => {} }
}

function follows(before: Element, after: Element): boolean {
  return Boolean(before.compareDocumentPosition(after) & Node.DOCUMENT_POSITION_FOLLOWING)
}

beforeEach(() => {
  FakeSource.all = []
  vi.stubGlobal('EventSource', FakeSource)
  calls.take.mockReset().mockResolvedValue({ control_id: 'bctl_1', since: 1, idle_timeout_seconds: 300 })
  calls.release.mockReset().mockResolvedValue(undefined)
  calls.input.mockReset().mockResolvedValue(undefined)
})
afterEach(() => { cleanup(); vi.unstubAllGlobals() })

describe('Browser panel layout', () => {
  it('shows the full page address above a fixed viewport that follows frames', () => {
    render(<PanelConversationContext.Provider value={panel()}><BrowserTab sessionId="s1" /></PanelConversationContext.Provider>)
    source().emit('frame', { data: 'AAA', url: 'https://e.com/path?q=1', title: 'E', width: 1280, height: 800 })
    const toolbar = screen.getByTestId('browser-toolbar')
    const viewport = screen.getByTestId('browser-viewport')
    expect(within(toolbar).getByText('e.com')).toBeInTheDocument()
    expect(within(toolbar).getByText('/path?q=1')).toBeInTheDocument()
    expect(within(toolbar).getByText('Live')).toBeInTheDocument()
    expect(within(viewport).getByTestId('browser-frame')).toHaveAttribute('src', 'data:image/jpeg;base64,AAA')
    expect(follows(toolbar, viewport)).toBe(true)

    source().emit('frame', { data: 'BBB', url: 'https://e.com/path?q=1', title: 'E', width: 800, height: 500 })
    expect(screen.getByTestId('browser-viewport')).toBe(viewport)
    expect(within(viewport).getByTestId('browser-frame')).toHaveAttribute('src', 'data:image/jpeg;base64,BBB')

    source().emit('frame', { data: 'CCC', url: 'https://other.com/', title: 'Other', width: 1280, height: 800 })
    expect(within(screen.getByTestId('browser-toolbar')).getByRole('link')).toHaveAttribute('href', 'https://other.com/')
  })

  it('collapses visited pages and opens them from a trigger below the viewport', async () => {
    const user = userEvent.setup()
    render(<PanelConversationContext.Provider value={panel([{ url: 'https://a.com/1', title: 'A' }, { url: 'https://b.com/2' }])}><BrowserTab sessionId="s1" /></PanelConversationContext.Provider>)
    source().emit('frame', { data: 'AAA', url: 'https://e.com/', title: 'E', width: 1280, height: 800 })
    const trigger = screen.getByRole('button', { name: /Pages visited \(2\)/ })
    expect(trigger).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByRole('link', { name: /a\.com/ })).not.toBeInTheDocument()
    expect(follows(screen.getByTestId('browser-viewport'), trigger)).toBe(true)
    await user.click(trigger)
    expect(trigger).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByRole('link', { name: /a\.com/ })).toHaveAttribute('href', 'https://a.com/1')
    expect(screen.getByRole('link', { name: /b\.com/ })).toHaveAttribute('href', 'https://b.com/2')
  })

  it('keeps the control explanation below the viewport', async () => {
    const user = userEvent.setup()
    render(<PanelConversationContext.Provider value={panel()}><BrowserTab sessionId="s1" /></PanelConversationContext.Provider>)
    source().emit('frame', { data: 'AAA', url: 'https://e.com/', title: 'E', width: 1280, height: 800 })
    await user.click(screen.getByRole('button', { name: 'Take control' }))
    const explanation = screen.getByText(/The agent waits until you hand the browser back/)
    expect(follows(screen.getByTestId('browser-viewport'), explanation)).toBe(true)
    expect(within(screen.getByTestId('browser-toolbar')).getByText('You have control')).toBeInTheDocument()
  })

  it('puts a blocked explanation below the viewport when a browser is unavailable', () => {
    render(<PanelConversationContext.Provider value={panel()}><BrowserTab sessionId="s1" /></PanelConversationContext.Provider>)
    source().emit('frame', { data: 'AAA', url: 'https://e.com/', title: 'E', width: 1280, height: 800 })
    source().emit('idle', { reason: 'no_browser' })
    const explanation = screen.getByText(/Its image has no browser/)
    expect(follows(screen.getByTestId('browser-viewport'), explanation)).toBe(true)
  })
})
