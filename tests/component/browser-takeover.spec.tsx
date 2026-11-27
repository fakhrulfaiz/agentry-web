// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import '../helpers/dom'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
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

const panel: PanelConversation = { tasks: [], jobs: [], subagentViews: [], todos: [], browser: { ...EMPTY_BROWSER, calls: 1 }, items: new Map(), actions: new Map(), answer: async () => {} }

function renderLive() {
  render(<PanelConversationContext.Provider value={panel}><BrowserTab sessionId="s1" /></PanelConversationContext.Provider>)
  source().emit('frame', { data: 'AAA', url: 'https://e.com/', title: 'E', width: 1280, height: 720, timestamp: 1 })
  const frame = screen.getByTestId('browser-frame')
  // jsdom has no layout: the frame fills a viewport shown at half size at (100, 50).
  const box = () => ({ left: 100, top: 50, width: 640, height: 360, right: 740, bottom: 410, x: 100, y: 50, toJSON: () => ({}) })
  frame.getBoundingClientRect = box
  screen.getByTestId('browser-viewport').getBoundingClientRect = box
  return frame
}

beforeEach(() => {
  FakeSource.all = []
  vi.stubGlobal('EventSource', FakeSource)
  calls.take.mockReset().mockResolvedValue({ control_id: 'bctl_1', since: 1, idle_timeout_seconds: 300 })
  calls.release.mockReset().mockResolvedValue(undefined)
  calls.input.mockReset().mockResolvedValue(undefined)
})
afterEach(() => { cleanup(); vi.unstubAllGlobals() })

describe('Browser tab take-over', () => {
  it('is read-only until the user takes control, then captures input in page pixels', async () => {
    const user = userEvent.setup()
    const frame = renderLive()
    expect(frame).not.toHaveAttribute('tabindex')
    fireEvent.pointerDown(frame, { clientX: 420, clientY: 230, button: 0, buttons: 1 })
    expect(calls.input).not.toHaveBeenCalled()

    await user.click(screen.getByRole('button', { name: 'Take control' }))
    expect(calls.take).toHaveBeenCalledWith('s1', false)
    expect(screen.getByText('You have control')).toBeInTheDocument()
    const app = screen.getByRole('application')
    expect(app).toHaveFocus()

    fireEvent.pointerDown(app, { clientX: 420, clientY: 230, button: 0, buttons: 1, detail: 1 })
    expect(calls.input).toHaveBeenLastCalledWith('s1', 'bctl_1', [
      { type: 'resize', width: 640, height: 360 },
      { type: 'mouse', action: 'down', x: 640, y: 360, button: 'left', buttons: 1, click_count: 1 },
    ])
    fireEvent.keyDown(app, { key: 'h', code: 'KeyH', keyCode: 72 })
    expect(calls.input).toHaveBeenLastCalledWith('s1', 'bctl_1', [{ type: 'key', action: 'down', key: 'h', code: 'KeyH', key_code: 72, text: 'h' }])

    // Esc is not sent: it leaves the frame.
    const sent = calls.input.mock.calls.length
    fireEvent.keyDown(app, { key: 'Escape', code: 'Escape', keyCode: 27 })
    expect(calls.input.mock.calls.length).toBe(sent)
    expect(app).not.toHaveFocus()

    await user.click(screen.getByRole('button', { name: 'Hand back' }))
    expect(calls.release).toHaveBeenCalledWith('s1', 'bctl_1')
    expect(screen.queryByText('You have control')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Take control' })).toBeInTheDocument()
  })

  it('says when control went back by itself, and offers to take it from another tab', async () => {
    const user = userEvent.setup()
    renderLive()
    await user.click(screen.getByRole('button', { name: 'Take control' }))
    source().emit('control', { controlled: false, reason: 'idle' })
    expect(screen.queryByText('You have control')).not.toBeInTheDocument()
    expect(screen.getByText(/after 5 minutes without input/)).toBeInTheDocument()

    const { ApiError } = await import('@/api/client') as unknown as { ApiError: new (s: number, c: string, m: string) => Error }
    calls.take.mockRejectedValueOnce(new ApiError(409, 'browser_control_held', 'held'))
    await user.click(screen.getByRole('button', { name: 'Take control' }))
    expect(screen.getByText('You have control in another tab')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Take control here' }))
    expect(calls.take).toHaveBeenLastCalledWith('s1', true)
    expect(screen.getByText('You have control')).toBeInTheDocument()
  })

  it('hands control back when the chat closes or the tab is hidden', async () => {
    const user = userEvent.setup()
    const { unmount } = render(<PanelConversationContext.Provider value={panel}><BrowserTab sessionId="s1" /></PanelConversationContext.Provider>)
    source().emit('frame', { data: 'AAA', url: 'https://e.com/', title: 'E', width: 1280, height: 720 })
    await user.click(screen.getByRole('button', { name: 'Take control' }))
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' })
    act(() => { document.dispatchEvent(new Event('visibilitychange')) })
    expect(calls.release).toHaveBeenCalledWith('s1', 'bctl_1')
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' })
    act(() => { document.dispatchEvent(new Event('visibilitychange')) })
    source().emit('frame', { data: 'BBB', url: 'https://e.com/', title: 'E', width: 1280, height: 720 })
    await user.click(screen.getByRole('button', { name: 'Take control' }))
    calls.release.mockClear()
    unmount()
    expect(calls.release).toHaveBeenCalledWith('s1', 'bctl_1')
  })
})
