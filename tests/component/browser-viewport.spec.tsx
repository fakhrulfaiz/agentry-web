// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import '../helpers/dom'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
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

afterEach(() => cleanup())

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

  it('maps a pointer at the drawn frame edge to the page point', () => {
    const send = vi.fn<(event: BrowserInputEvent) => void>()
    render(<BrowserViewport {...base} inControl send={send} />)
    const img = screen.getByTestId('browser-frame')
    rect(640, 400)(img)
    fireEvent.pointerDown(img, { clientX: 420, clientY: 250, button: 0, buttons: 1, detail: 1 })
    expect(send).toHaveBeenCalledWith({ type: 'mouse', action: 'down', x: 640, y: 400, button: 'left', buttons: 1, click_count: 1 })
  })

  it('resizes the page to the fixed viewport ratio, clamped to the API limits', () => {
    const send = vi.fn<(event: BrowserInputEvent) => void>()
    const { rerender, unmount } = render(<BrowserViewport {...base} inControl send={send} />)
    rect(640, 400)(screen.getByTestId('browser-frame'))
    // A new frame re-runs the fit effect; jsdom has no ResizeObserver or layout of its own.
    rerender(<BrowserViewport {...base} frame={{ ...frame }} inControl send={send} />)
    expect(send).toHaveBeenCalledWith({ type: 'resize', width: 640, height: 400 })
    unmount()

    const clamped = vi.fn<(event: BrowserInputEvent) => void>()
    const { rerender: rerenderWide } = render(<BrowserViewport {...base} inControl send={clamped} />)
    rect(2000, 1250)(screen.getByTestId('browser-frame'))
    rerenderWide(<BrowserViewport {...base} frame={{ ...frame }} inControl send={clamped} />)
    expect(clamped).toHaveBeenCalledWith({ type: 'resize', width: 1920, height: 1200 })
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
})
