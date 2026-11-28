// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import '../helpers/dom'
import { act, cleanup, render, renderHook, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { parseFocus, parsePointer, useBrowserLive } from '@/chat/use-browser-live'
import { BrowserCursor, CURSOR_HIDE_MS } from '@/ui/preview/BrowserCursor'
import { BrowserViewport } from '@/ui/preview/BrowserViewport'

/** jsdom has no layout: the cursor layer is 640x400 for a 1280x800 page (scale 0.5). */
function mockLayer() {
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function mockRect(this: Element) {
    const [w, h] = this.getAttribute('data-testid') === 'browser-cursor-layer' ? [640, 400] : [0, 0]
    return { left: 0, top: 0, width: w, height: h, right: w, bottom: h, x: 0, y: 0, toJSON: () => ({}) } as DOMRect
  })
}
const page = { width: 1280, height: 800 }
const pointer = (over: Partial<{ x: number; y: number; action: 'move' | 'down' | 'up'; at: number }> = {}) => ({ x: 400, y: 200, action: 'move' as const, at: 1, ...over })

afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers() })

describe('BrowserCursor', () => {
  beforeEach(() => { mockLayer() })

  it('is hidden before the first event', () => {
    render(<BrowserCursor pointer={undefined} focus={undefined} page={page} inControl={false} />)
    expect(screen.queryByTestId('browser-cursor')).not.toBeInTheDocument()
  })

  it('moves to the page point scaled into the frame box', () => {
    render(<BrowserCursor pointer={pointer()} focus={undefined} page={page} inControl={false} />)
    expect(screen.getByTestId('browser-cursor')).toHaveStyle({ transform: 'translate(200px, 100px)' })
  })

  it('shows a ripple on a press, and none on a move', () => {
    const { rerender } = render(<BrowserCursor pointer={pointer()} focus={undefined} page={page} inControl={false} />)
    expect(screen.queryByTestId('browser-cursor-ring')).not.toBeInTheDocument()
    rerender(<BrowserCursor pointer={pointer({ action: 'down', at: 2 })} focus={undefined} page={page} inControl={false} />)
    expect(screen.getByTestId('browser-cursor-ring')).toBeInTheDocument()
  })

  it('outlines the focused field in frame pixels', () => {
    render(<BrowserCursor pointer={undefined} focus={{ x: 100, y: 100, width: 400, height: 40, at: 1 }} page={page} inControl={false} />)
    expect(screen.getByTestId('browser-cursor-focus')).toHaveStyle({ left: '50px', top: '50px', width: '200px', height: '20px' })
  })

  it('hides after three seconds without events', () => {
    vi.useFakeTimers()
    render(<BrowserCursor pointer={pointer()} focus={undefined} page={page} inControl={false} />)
    expect(screen.getByTestId('browser-cursor')).toBeInTheDocument()
    act(() => { vi.advanceTimersByTime(CURSOR_HIDE_MS + 10) })
    expect(screen.queryByTestId('browser-cursor')).not.toBeInTheDocument()
  })

  it('is hidden while the user has control', () => {
    render(<BrowserCursor pointer={pointer()} focus={{ x: 1, y: 1, width: 5, height: 5, at: 1 }} page={page} inControl />)
    expect(screen.queryByTestId('browser-cursor')).not.toBeInTheDocument()
    expect(screen.queryByTestId('browser-cursor-focus')).not.toBeInTheDocument()
  })

  it('has no glide and no ripple with reduced motion', () => {
    vi.stubGlobal('matchMedia', (q: string) => ({ matches: q.includes('reduced-motion'), addEventListener() {}, removeEventListener() {} }))
    render(<BrowserCursor pointer={pointer({ action: 'down' })} focus={undefined} page={page} inControl={false} />)
    expect(screen.getByTestId('browser-cursor')).toBeInTheDocument()
    expect(screen.queryByTestId('browser-cursor-ring')).not.toBeInTheDocument()
  })

  it('draws over a live frame only, not a stored screenshot', () => {
    const frame = { src: 'data:image/jpeg;base64,AAA', url: 'https://e.com/', title: 'E', ...page }
    const props = { screenshotUrl: null, inControl: false, send: () => {}, pointer: pointer() }
    const { unmount } = render(<BrowserViewport {...props} frame={frame} />)
    expect(screen.getByTestId('browser-cursor-layer')).toBeInTheDocument()
    unmount()
    render(<BrowserViewport {...props} frame={null} screenshotUrl="/x" />)
    expect(screen.queryByTestId('browser-cursor-layer')).not.toBeInTheDocument()
  })
})

class FakeSource {
  static all: FakeSource[] = []
  listeners = new Map<string, (e: MessageEvent<string>) => void>()
  constructor(readonly url: string) { FakeSource.all.push(this) }
  addEventListener(name: string, fn: (e: MessageEvent<string>) => void) { this.listeners.set(name, fn) }
  close() {}
  emit(name: string, data: unknown = {}) { act(() => { this.listeners.get(name)?.({ data: JSON.stringify(data) } as MessageEvent<string>) }) }
}

describe('useBrowserLive pointer and focus', () => {
  beforeEach(() => { FakeSource.all = []; vi.stubGlobal('EventSource', FakeSource) })
  const frame = (url: string) => ({ data: 'AAA', url, title: 'T', width: 1280, height: 800 })

  it('parses events', () => {
    expect(parsePointer('{"action":"down","x":1,"y":2}', 7)).toEqual({ x: 1, y: 2, action: 'down', at: 7 })
    expect(parsePointer('{"action":"zoom","x":1,"y":2}', 7)).toBeUndefined()
    expect(parsePointer('nope', 7)).toBeUndefined()
    expect(parseFocus('{"x":1,"y":2,"width":3,"height":4}', 7)).toEqual({ x: 1, y: 2, width: 3, height: 4, at: 7 })
    expect(parseFocus('{"x":1,"y":2,"width":3}', 7)).toBeUndefined()
  })

  it('exposes pointer and focus; a new page clears the focus but keeps the arrow; idle and a reconnect clear both', () => {
    const { result } = renderHook(() => useBrowserLive('s1'))
    const source = FakeSource.all[0]!
    source.emit('frame', frame('https://a.com/'))
    source.emit('pointer', { action: 'move', x: 10, y: 20, timestamp: 1 })
    source.emit('focus', { x: 1, y: 2, width: 3, height: 4, timestamp: 1 })
    expect(result.current.pointer).toMatchObject({ x: 10, y: 20, action: 'move' })
    expect(result.current.focus).toMatchObject({ width: 3 })

    source.emit('frame', frame('https://a.com/'))
    expect(result.current.pointer).toBeDefined()
    // The click that followed a link: the new page's frame arrives after it, and the arrow must still show.
    source.emit('frame', frame('https://b.com/'))
    expect(result.current.pointer).toMatchObject({ x: 10, y: 20 })
    expect(result.current.focus).toBeUndefined()

    source.emit('pointer', { action: 'down', x: 1, y: 1 })
    source.emit('idle', { reason: 'not_started' })
    expect(result.current.pointer).toBeUndefined()

    source.emit('pointer', { action: 'down', x: 1, y: 1 })
    source.emit('open')
    expect(result.current.pointer).toBeUndefined()
  })
})
