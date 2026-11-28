// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import '../helpers/dom'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

/** jsdom has no layout: give the viewport and the image deliberately different boxes. */
function mockBoxes(viewport: [number, number], frame: [number, number]) {
  const box = ([w, h]: [number, number]) => ({ left: 100, top: 50, width: w, height: h, right: 100 + w, bottom: 50 + h, x: 100, y: 50, toJSON: () => ({}) })
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function mockRect(this: Element) {
    if (this.getAttribute('data-testid') === 'browser-viewport') return box(viewport) as DOMRect
    if (this.getAttribute('data-testid') === 'browser-frame') return box(frame) as DOMRect
    return box([0, 0]) as DOMRect
  })
}
import type { BrowserInputEvent } from '@/chat/browser-input'
import type { LiveFrame } from '@/chat/use-browser-live'
import { BrowserViewport, type BrowserViewportProps } from '@/ui/preview/BrowserViewport'

const frame: LiveFrame = { src: 'data:image/jpeg;base64,AAA', url: 'https://e.com/', title: 'E', width: 1280, height: 800 }
const base: BrowserViewportProps = { frame, screenshotUrl: null, inControl: false, send: () => {} }

function rect(width: number, height: number) {
  return (element: Element) => {
    element.getBoundingClientRect = () => ({ left: 100, top: 50, width, height, right: 100 + width, bottom: 50 + height, x: 100, y: 50, toJSON: () => ({}) })
  }
}

afterEach(() => { cleanup(); vi.restoreAllMocks() })

describe('Browser viewport', () => {
  it('keeps a contained image inside the fixed viewport, live or from a tool screenshot', () => {
    const { unmount } = render(<BrowserViewport {...base} />)
    expect(screen.getByTestId('browser-frame')).toHaveAttribute('data-fit', 'contain')
    expect(screen.getByTestId('browser-viewport')).toContainElement(screen.getByTestId('browser-frame'))
    unmount()

    render(<BrowserViewport {...base} frame={null} screenshotUrl="/api/agentry/agents/files/f1/content" />)
    expect(screen.getByTestId('browser-frame')).toHaveAttribute('src', '/api/agentry/agents/files/f1/content')
    expect(screen.getByTestId('browser-viewport')).toContainElement(screen.getByTestId('browser-frame'))
  })

  it('labels a stored screenshot as a screenshot, not a live view', () => {
    render(<BrowserViewport {...base} frame={null} screenshotUrl="/api/agentry/agents/files/f1/content" />)
    expect(screen.getByTestId('browser-frame')).toHaveAccessibleName(/Latest screenshot/)
  })

  it('maps a pointer at the drawn frame edge to the page point', () => {
    const send = vi.fn<(event: BrowserInputEvent) => void>()
    render(<BrowserViewport {...base} inControl send={send} />)
    const img = screen.getByTestId('browser-frame')
    rect(640, 400)(img)
    fireEvent.pointerDown(img, { clientX: 420, clientY: 250, button: 0, buttons: 1, detail: 1 })
    expect(send).toHaveBeenCalledWith({ type: 'mouse', action: 'down', x: 640, y: 400, button: 'left', buttons: 1, click_count: 1 })
  })

  it('resizes the page to the viewport ratio, not the frame ratio, clamped to the API limits', () => {
    const send = vi.fn<(event: BrowserInputEvent) => void>()
    // A 4:3 image inside a 16:10 viewport: fitting to the image would ask for 640x480.
    mockBoxes([640, 400], [640, 480])
    render(<BrowserViewport {...base} inControl send={send} />)
    expect(send).toHaveBeenCalledWith({ type: 'resize', width: 640, height: 400 })
    cleanup()

    const clamped = vi.fn<(event: BrowserInputEvent) => void>()
    mockBoxes([2000, 1250], [2000, 1250])
    render(<BrowserViewport {...base} inControl send={clamped} />)
    expect(clamped).toHaveBeenCalledWith({ type: 'resize', width: 1920, height: 1200 })
  })

  it('keeps focus on a control while new live frames arrive', () => {
    const send = vi.fn<(event: BrowserInputEvent) => void>()
    const view = (f: LiveFrame) => (
      <>
        <BrowserViewport {...base} frame={f} inControl send={send} />
        <button data-testid="handback">Hand back</button>
      </>
    )
    const { rerender } = render(view(frame))
    const handBack = screen.getByTestId('handback')
    handBack.focus()
    expect(handBack).toHaveFocus()

    rerender(view({ ...frame, src: 'data:image/jpeg;base64,BBB' }))
    expect(handBack).toHaveFocus()
  })

  it('fits the page again when control is taken a second time at the same width', () => {
    const send = vi.fn<(event: BrowserInputEvent) => void>()
    mockBoxes([640, 400], [640, 400])
    const view = (inControl: boolean) => <BrowserViewport {...base} inControl={inControl} send={send} />
    const { rerender } = render(view(false))
    rerender(view(true))
    expect(send).toHaveBeenCalledTimes(1)
    rerender(view(false))
    rerender(view(true))
    expect(send).toHaveBeenCalledTimes(2)
    expect(send).toHaveBeenLastCalledWith({ type: 'resize', width: 640, height: 400 })
  })

  it('lets Escape leave the frame and sends typed keys', () => {
    const send = vi.fn<(event: BrowserInputEvent) => void>()
    render(<BrowserViewport {...base} inControl send={send} />)
    const img = screen.getByTestId('browser-frame')
    img.focus()
    fireEvent.keyDown(img, { key: 'Escape', code: 'Escape', keyCode: 27 })
    expect(send).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'key', key: 'Escape' }))
    expect(img).not.toHaveFocus()
    fireEvent.keyDown(img, { key: 'h', code: 'KeyH', keyCode: 72 })
    expect(send).toHaveBeenCalledWith({ type: 'key', action: 'down', key: 'h', code: 'KeyH', key_code: 72, text: 'h' })
  })

  it('fits the page inside the panel-sized viewport keeping its aspect, whatever the page size', () => {
    const send = vi.fn<(event: BrowserInputEvent) => void>()
    // A 900x700 viewport and a 1280x800 page: drawn 900x562.5, letterboxed 68.75 above and below.
    mockBoxes([900, 700], [900, 700])
    render(<BrowserViewport {...base} inControl send={send} />)
    const img = screen.getByTestId('browser-frame')
    expect(img).toHaveAttribute('data-fit', 'contain')
    fireEvent.pointerDown(img, { clientX: 100 + 450, clientY: 50 + 350, button: 0, buttons: 1, detail: 1 })
    expect(send).toHaveBeenCalledWith(expect.objectContaining({ type: 'mouse', action: 'down', x: 640, y: 400 }))
    send.mockClear()
    // Inside the letterbox, above the drawn page: nothing is sent.
    fireEvent.pointerDown(img, { clientX: 100 + 450, clientY: 50 + 20, button: 0, buttons: 1, detail: 1 })
    expect(send).not.toHaveBeenCalled()
  })
})
