// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import '../helpers/dom'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const openFile = vi.fn()
vi.mock('@/preview/store', async (orig) => {
  const actual = await orig<typeof import('@/preview/store')>()
  return { ...actual, usePreviewPanel: () => ({ state: actual.initialState(), actions: { openFile } }) }
})

const { VideoView } = await import('@/ui/preview/renderers/VideoView')
const { ToolCard } = await import('@/ui/chat/ToolCard')

const SIDECAR = [
  '{"type":"meta","version":1,"fps":10,"started_at":1}',
  '{"t":0,"type":"viewport","width":800,"height":600,"video_width":800,"video_height":600}',
  '{"t":1000,"type":"pointer","action":"move","x":400,"y":300}',
  '{"t":2000,"type":"pointer","action":"down","x":200,"y":100}',
].join('\n')

/** jsdom has no layout: the video element is 400x300 (the 800x600 page at half size). */
function mockLayout() {
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function mockRect(this: Element) {
    const id = this.getAttribute('data-testid')
    const [w, h] = id === 'preview-video' ? [400, 300] : id === 'browser-cursor-layer' ? [400, 300] : [0, 0]
    return { left: 0, top: 0, width: w, height: h, right: w, bottom: h, x: 0, y: 0, toJSON: () => ({}) } as DOMRect
  })
}

function loaded(video: HTMLVideoElement, at: number) {
  Object.defineProperty(video, 'videoWidth', { configurable: true, value: 800 })
  Object.defineProperty(video, 'videoHeight', { configurable: true, value: 600 })
  Object.defineProperty(video, 'currentTime', { configurable: true, writable: true, value: at })
  fireEvent.loadedMetadata(video)
}

afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); openFile.mockReset() })

describe('VideoView', () => {
  beforeEach(() => { mockLayout() })

  it('plays the file and draws the cursor at the video time', async () => {
    const fetchMock = vi.fn(async (_url: string) => new Response(SIDECAR, { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    render(<VideoView sessionId="sess_1" path="recordings/demo.webm" reloadKey={0} />)
    const video = screen.getByTestId('preview-video') as HTMLVideoElement
    expect(video).toHaveAttribute('src', '/api/agentry/agents/sessions/sess_1/artifacts/recordings/demo.webm')
    expect(video).toHaveAttribute('controls')
    expect(String(fetchMock.mock.calls[0]![0])).toBe('/api/agentry/agents/sessions/sess_1/artifacts/recordings/demo.cursor.jsonl')
    act(() => { loaded(video, 1.5) })
    await waitFor(() => { expect(screen.getByTestId('video-cursor-overlay')).toBeInTheDocument() })
    act(() => { fireEvent(video, new Event('seeked')) })
    await waitFor(() => { expect(screen.getByTestId('browser-cursor')).toHaveStyle({ transform: 'translate(200px, 150px)' }) })
    expect(screen.getByTestId('browser-cursor')).toHaveAttribute('data-action', 'move')
    act(() => { video.currentTime = 2.1; fireEvent(video, new Event('seeked')) })
    await waitFor(() => { expect(screen.getByTestId('browser-cursor')).toHaveAttribute('data-action', 'down') })
    expect(screen.getByTestId('browser-cursor')).toHaveStyle({ transform: 'translate(100px, 50px)' })
    // Three seconds of video after the last event, the cursor is gone.
    act(() => { video.currentTime = 5.5; fireEvent(video, new Event('seeked')) })
    await waitFor(() => { expect(screen.queryByTestId('browser-cursor')).not.toBeInTheDocument() })
    // Before the first event there is none either.
    act(() => { video.currentTime = 0.5; fireEvent(video, new Event('seeked')) })
    await waitFor(() => { expect(screen.queryByTestId('browser-cursor')).not.toBeInTheDocument() })
  })

  it('plays a video without a cursor file and draws nothing over it', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 404 })))
    render(<VideoView sessionId="sess_1" path="clip.mp4" reloadKey={0} />)
    const video = screen.getByTestId('preview-video') as HTMLVideoElement
    act(() => { loaded(video, 1) })
    await new Promise((r) => { setTimeout(r, 20) })
    expect(screen.queryByTestId('video-cursor-overlay')).not.toBeInTheDocument()
  })
})

describe('recording tool cards', () => {
  it('titles a saved recording and opens it in the side panel', () => {
    render(<ToolCard view={{ kind: 'tool', id: 't1', callId: 'c1', name: 'browser_recording_stop', args: {}, status: 'done', output: JSON.stringify({ path: 'recordings/demo.webm', cursor_path: 'recordings/demo.cursor.jsonl', duration_seconds: 4.2, size_bytes: 100 }) }} />)
    expect(screen.getByText('Saved recording demo.webm')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Open demo.webm' }))
    expect(openFile).toHaveBeenCalledWith('recordings/demo.webm')
  })

  it('titles a start, without a file link', () => {
    render(<ToolCard view={{ kind: 'tool', id: 't2', callId: 'c2', name: 'browser_recording_start', args: { name: 'demo' }, status: 'done', output: '{"recording":true,"path":"recordings/demo.webm"}' }} />)
    expect(screen.getByText('Started recording')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^Open / })).not.toBeInTheDocument()
  })
})
