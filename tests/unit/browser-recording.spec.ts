import { describe, expect, it } from 'vitest'
import { artifactKind, contentTypeForName, previewMode } from '@/artifacts/kind'
import { artifactDisposition } from '@/server/artifact-bytes'
import { parseRange, sliceStream } from '@/server/byte-range'
import { recordingAction, recordingCard } from '@/chat/browser-tools'
import { cursorAt, cursorPathFor, pageRect, parseCursorTrack } from '@/preview/cursor-track'

describe('video files', () => {
  it('are a video kind, previewed as video, served inline as video types', () => {
    expect(artifactKind({ name: 'demo.webm', mime_type: 'application/octet-stream' })).toBe('video')
    expect(artifactKind({ name: 'clip.mp4', mime_type: 'video/mp4' })).toBe('video')
    expect(previewMode({ name: 'demo.webm', mime_type: 'application/octet-stream' })).toBe('video')
    expect(contentTypeForName('demo.webm')).toBe('video/webm')
    expect(contentTypeForName('clip.mp4')).toBe('video/mp4')
    expect(artifactDisposition('demo.webm', false)).toContain('inline')
    expect(artifactDisposition('demo.webm', true)).toContain('attachment')
  })
})

describe('recording tool cards', () => {
  const view = (name: string, output: unknown, status: 'running' | 'done' | 'failed' = 'done') => ({ name, output, status })

  it('recognises the two tools only', () => {
    expect(recordingAction('browser_recording_start')).toBe('start')
    expect(recordingAction('browser_recording_stop')).toBe('stop')
    expect(recordingAction('mcp__browser__browser_navigate')).toBeNull()
    expect(recordingCard(view('bash', '{}'))).toBeNull()
  })

  it('titles a start and a saved recording, with the file to open', () => {
    expect(recordingCard(view('browser_recording_start', '{"recording":true,"path":"recordings/demo.webm"}'))).toEqual({ title: 'Started recording' })
    expect(recordingCard(view('browser_recording_stop', JSON.stringify({ path: 'recordings/demo.webm', cursor_path: 'recordings/demo.cursor.jsonl', duration_seconds: 4.2, size_bytes: 10 }))))
      .toEqual({ title: 'Saved recording demo.webm', file: 'recordings/demo.webm' })
  })

  it('handles running, refusals and a recording that stopped by itself', () => {
    expect(recordingCard(view('browser_recording_stop', undefined, 'running'))).toEqual({ title: 'Saving recording' })
    expect(recordingCard(view('browser_recording_stop', '{"error":"not_recording","message":"x"}'))).toEqual({ title: 'No recording to stop' })
    expect(recordingCard(view('browser_recording_start', '{"error":"browser_not_started","message":"x"}'))).toEqual({ title: 'Could not start recording' })
    expect(recordingCard(view('browser_recording_start', JSON.stringify({ recording: true, path: 'recordings/b.webm', earlier_recording: { path: 'recordings/a.webm', reason: 'turn_end' } }))))
      .toEqual({ title: 'Started recording', file: 'recordings/a.webm' })
  })
})

describe('cursor track', () => {
  const text = [
    '{"type":"meta","version":1,"fps":10,"started_at":1}',
    '{"t":0,"type":"viewport","width":800,"height":600,"video_width":800,"video_height":600}',
    '{"t":1200,"type":"pointer","action":"down","x":10,"y":20}',
    'not json',
    '{"t":1000,"type":"pointer","action":"move","x":5,"y":6}',
    '{"t":1300,"type":"focus","x":1,"y":2,"width":100,"height":20}',
    '{"t":2000,"type":"viewport","width":400,"height":600}',
    '{"t":-5,"type":"pointer","action":"move","x":1,"y":1}',
  ].join('\n')

  it('parses and sorts lines, skipping bad ones', () => {
    const track = parseCursorTrack(text)
    expect(track.pointers.map((p) => p.t)).toEqual([1000, 1200])
    expect(track.focuses).toHaveLength(1)
    expect(track.viewports).toEqual([{ t: 0, width: 800, height: 600 }, { t: 2000, width: 400, height: 600 }])
  })

  it('looks up the state at a video time', () => {
    const track = parseCursorTrack(text)
    expect(cursorAt(track, 500)).toEqual({ page: { width: 800, height: 600 } })
    expect(cursorAt(track, 1250)).toEqual({ pointer: { x: 10, y: 20, action: 'down', at: 1200 }, page: { width: 800, height: 600 } })
    expect(cursorAt(track, 2500)).toMatchObject({ focus: { at: 1300 }, page: { width: 400, height: 600 } })
  })

  it('places the page in the element: video letterboxed, then the page inside the video', () => {
    // 800x600 video in a 400x400 box: drawn 400x300 at top 50. Same-shaped page fills it.
    expect(pageRect({ width: 400, height: 400 }, { width: 800, height: 600 }, { width: 1600, height: 1200 })).toEqual({ left: 0, top: 50, width: 400, height: 300 })
    // A narrower page (400x600) is centred in the 800x600 video: 400 wide in video px, 200 in the box.
    expect(pageRect({ width: 400, height: 400 }, { width: 800, height: 600 }, { width: 400, height: 600 })).toEqual({ left: 100, top: 50, width: 200, height: 300 })
    expect(pageRect({ width: 0, height: 0 }, { width: 800, height: 600 }, { width: 800, height: 600 })).toBeUndefined()
  })

  it('names the sidecar beside the video', () => {
    expect(cursorPathFor('recordings/demo.webm')).toBe('recordings/demo.cursor.jsonl')
    expect(cursorPathFor('a/clip.MP4')).toBe('a/clip.cursor.jsonl')
  })
})

describe('byte ranges', () => {
  it('parses one range, open-ended and suffix ranges', () => {
    expect(parseRange('bytes=0-99', 1000)).toEqual({ start: 0, end: 99 })
    expect(parseRange('bytes=500-', 1000)).toEqual({ start: 500, end: 999 })
    expect(parseRange('bytes=-100', 1000)).toEqual({ start: 900, end: 999 })
    expect(parseRange('bytes=900-5000', 1000)).toEqual({ start: 900, end: 999 })
  })

  it('answers unsatisfiable or whole-file for the rest', () => {
    expect(parseRange('bytes=1000-', 1000)).toBe('unsatisfiable')
    expect(parseRange('bytes=5-2', 1000)).toBe('unsatisfiable')
    expect(parseRange(null, 1000)).toBeUndefined()
    expect(parseRange('bytes=0-1,5-6', 1000)).toBeUndefined()
    expect(parseRange('items=0-1', 1000)).toBeUndefined()
  })

  it('slices a stream across chunks', async () => {
    const chunks = [new Uint8Array([0, 1, 2, 3]), new Uint8Array([4, 5, 6, 7]), new Uint8Array([8, 9])]
    const body = new ReadableStream<Uint8Array>({ start(c) { for (const chunk of chunks) c.enqueue(chunk); c.close() } })
    const out = new Uint8Array(await new Response(sliceStream(body, 3, 8)).arrayBuffer())
    expect([...out]).toEqual([3, 4, 5, 6, 7, 8])
  })
})
