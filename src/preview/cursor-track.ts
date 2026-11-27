/**
 * The agent's cursor in a browser recording: the sidecar `<name>.cursor.jsonl` the API writes beside
 * `<name>.webm` (JSON lines, `t` in ms of video time, coordinates in the page's CSS pixels), read into a
 * track and looked up at a video time. Pure and client-safe.
 */
import type { LiveFocus, LivePointer } from '@/chat/use-browser-live'

export interface CursorViewport { t: number; width: number; height: number }
export interface CursorTrack {
  pointers: { t: number; action: LivePointer['action']; x: number; y: number }[]
  focuses: { t: number; x: number; y: number; width: number; height: number }[]
  viewports: CursorViewport[]
}

const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined)

/** Parses the sidecar; bad lines are skipped. Each list is sorted by time. */
export function parseCursorTrack(text: string): CursorTrack {
  const track: CursorTrack = { pointers: [], focuses: [], viewports: [] }
  for (const line of text.split('\n')) {
    if (line.trim() === '') continue
    let o: Record<string, unknown>
    try {
      const parsed: unknown = JSON.parse(line)
      if (!parsed || typeof parsed !== 'object') continue
      o = parsed as Record<string, unknown>
    } catch {
      continue
    }
    const t = num(o['t'])
    if (t === undefined || t < 0) continue
    const x = num(o['x'])
    const y = num(o['y'])
    const width = num(o['width'])
    const height = num(o['height'])
    if (o['type'] === 'pointer' && x !== undefined && y !== undefined && (o['action'] === 'move' || o['action'] === 'down' || o['action'] === 'up')) {
      track.pointers.push({ t, action: o['action'], x, y })
    } else if (o['type'] === 'focus' && x !== undefined && y !== undefined && width !== undefined && height !== undefined) {
      track.focuses.push({ t, x, y, width, height })
    } else if (o['type'] === 'viewport' && width !== undefined && height !== undefined && width > 0 && height > 0) {
      track.viewports.push({ t, width, height })
    }
  }
  const byTime = (a: { t: number }, b: { t: number }) => a.t - b.t
  track.pointers.sort(byTime)
  track.focuses.sort(byTime)
  track.viewports.sort(byTime)
  return track
}

/** The last entry at or before `ms` (binary search), or undefined. */
function lastAt<T extends { t: number }>(list: readonly T[], ms: number): T | undefined {
  let lo = 0
  let hi = list.length - 1
  let found: T | undefined
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    const item = list[mid]!
    if (item.t <= ms) {
      found = item
      lo = mid + 1
    } else hi = mid - 1
  }
  return found
}

/** What the cursor overlay shows at video time `ms`: `at` is the event's video time. */
export function cursorAt(track: CursorTrack, ms: number): { pointer?: LivePointer; focus?: LiveFocus; page?: { width: number; height: number } } {
  const p = lastAt(track.pointers, ms)
  const f = lastAt(track.focuses, ms)
  const v = lastAt(track.viewports, ms) ?? track.viewports[0]
  return {
    ...(p ? { pointer: { x: p.x, y: p.y, action: p.action, at: p.t } } : {}),
    ...(f ? { focus: { x: f.x, y: f.y, width: f.width, height: f.height, at: f.t } } : {}),
    ...(v ? { page: { width: v.width, height: v.height } } : {}),
  }
}

export interface Rect { left: number; top: number; width: number; height: number }

/**
 * Where the page is drawn inside the video element: the video fills the element keeping its aspect (letterboxed),
 * and the page fills the video the same way (the recorder scales each frame to fit and centres it).
 * @param box - the element's size; @param video - the video's intrinsic size; @param page - the page's CSS size.
 */
export function pageRect(box: { width: number; height: number }, video: { width: number; height: number }, page: { width: number; height: number }): Rect | undefined {
  if (box.width <= 0 || box.height <= 0 || video.width <= 0 || video.height <= 0 || page.width <= 0 || page.height <= 0) return undefined
  const s1 = Math.min(box.width / video.width, box.height / video.height)
  const s2 = Math.min(video.width / page.width, video.height / page.height)
  const width = page.width * s2 * s1
  const height = page.height * s2 * s1
  return {
    left: (box.width - video.width * s1) / 2 + ((video.width - page.width * s2) / 2) * s1,
    top: (box.height - video.height * s1) / 2 + ((video.height - page.height * s2) / 2) * s1,
    width,
    height,
  }
}

/** `<name>.cursor.jsonl` beside a video `<name>.webm` / `.mp4`. */
export function cursorPathFor(videoPath: string): string {
  return videoPath.replace(/\.(webm|mp4)$/i, '') + '.cursor.jsonl'
}
