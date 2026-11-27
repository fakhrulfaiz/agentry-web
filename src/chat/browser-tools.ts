/**
 * The web browser's tool calls (Playwright MCP, `mcp__browser__browser_*`): readable titles for
 * tool cards and what the panel's Browser tab shows (current page, latest screenshot, pages visited).
 */
import type { OAIOutputImagePart } from '@/api/types'
import type { MessageView } from './reducer'

type ToolView = Extract<MessageView, { kind: 'tool' }>

/** The tool's short name (`navigate`, `click`, …) for a browser tool call, else `null`. */
export function browserAction(name: string): string | null {
  const m = /^(?:mcp__browser__|browser\.)browser_([a-z_]+)$/.exec(name)
  return m ? m[1]! : null
}

function argsOf(args: unknown): Record<string, unknown> {
  if (typeof args === 'string') {
    try {
      const parsed: unknown = JSON.parse(args)
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {}
    } catch {
      return {}
    }
  }
  return args && typeof args === 'object' && !Array.isArray(args) ? (args as Record<string, unknown>) : {}
}

const str = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() ? v.trim() : undefined)

/** `example.com/path` for a URL (no scheme, no trailing slash); the input when it is not a URL. */
export function shortUrl(url: string): string {
  try {
    const u = new URL(url)
    const rest = `${u.pathname === '/' ? '' : u.pathname}${u.search}`
    return `${u.host}${rest}`.slice(0, 80)
  } catch {
    return url.slice(0, 80)
  }
}

/** The element a click or type targets, as Playwright MCP describes it (`element`), quoted. */
function target(a: Record<string, unknown>): string {
  const el = str(a['element'])
  return el ? ` ${el.length > 50 ? `${el.slice(0, 49)}…` : el}` : ''
}

/** A readable title for a browser tool call ("Opened example.com", "Clicked Submit"); `null` for other tools. */
export function browserToolTitle(name: string, rawArgs: unknown): string | null {
  const action = browserAction(name)
  if (action === null) return null
  const a = argsOf(rawArgs)
  switch (action) {
    case 'navigate': {
      const url = str(a['url'])
      return url ? `Opened ${shortUrl(url)}` : 'Opened a page'
    }
    case 'navigate_back': return 'Went back'
    case 'click': return `${a['doubleClick'] === true ? 'Double-clicked' : 'Clicked'}${target(a) || ' on the page'}`
    case 'hover': return `Hovered over${target(a) || ' the page'}`
    case 'type': return `Typed into${target(a) || ' a field'}`
    case 'fill_form': return 'Filled in a form'
    case 'select_option': return `Chose an option in${target(a) || ' a list'}`
    case 'press_key': return str(a['key']) ? `Pressed ${str(a['key'])}` : 'Pressed a key'
    case 'snapshot': return 'Read the page'
    case 'take_screenshot': return 'Took a screenshot'
    case 'wait_for': return str(a['text']) ? `Waited for “${str(a['text'])}”` : 'Waited'
    case 'tabs': return 'Managed tabs'
    case 'close': return 'Closed the browser'
    case 'resize': return 'Resized the window'
    case 'file_upload': return 'Uploaded a file'
    case 'handle_dialog': return 'Answered a dialog'
    case 'drag': case 'drop': return 'Dragged an element'
    case 'evaluate': case 'run_code_unsafe': return 'Ran a script on the page'
    case 'console_messages': return 'Read the console'
    case 'network_requests': case 'network_request': return 'Read network requests'
    case 'find': return 'Searched the page'
    default: return `Browser: ${action.replace(/_/g, ' ')}`
  }
}

/** The page a browser call left the browser on: `Page URL:` / `Page Title:` in its result, else a navigate call's `url`. */
export function pageOf(view: Pick<ToolView, 'name' | 'args' | 'output'>): { url: string; title?: string } | null {
  const text = typeof view.output === 'string' ? view.output : view.output === undefined ? '' : JSON.stringify(view.output)
  const url = /Page URL:\s*(\S+?)(?:\\n|\s|$)/.exec(text)?.[1]
  const title = /Page Title:\s*(.+?)(?:\\n|\n|$)/.exec(text)?.[1]?.trim()
  if (url) return { url, ...(title ? { title } : {}) }
  if (browserAction(view.name) === 'navigate') {
    const asked = str(argsOf(view.args)['url'])
    if (asked) return { url: asked }
  }
  return null
}

export interface BrowserState {
  /** How many browser calls the chat has made (grows as the agent acts). */
  calls: number
  /** The latest call is still running. */
  running: boolean
  current: { url: string; title?: string } | null
  /** The newest screenshot a browser call returned. */
  screenshot: OAIOutputImagePart | null
  /** Pages visited, in order, without repeats of the same URL in a row. */
  visited: { url: string; title?: string }[]
}

export const EMPTY_BROWSER: BrowserState = { calls: 0, running: false, current: null, screenshot: null, visited: [] }

/** What the Browser tab shows, from the chat's items. */
export function browserState(items: readonly MessageView[]): BrowserState {
  const state: BrowserState = { calls: 0, running: false, current: null, screenshot: null, visited: [] }
  for (const v of items) {
    if (v.kind !== 'tool' || browserAction(v.name) === null) continue
    state.calls++
    state.running = v.status === 'running'
    const page = pageOf(v)
    if (page) {
      state.current = page
      const last = state.visited[state.visited.length - 1]
      if (last?.url === page.url) state.visited[state.visited.length - 1] = page
      else state.visited.push(page)
    }
    const image = v.images?.findLast((i) => i.media_type.startsWith('image/'))
    if (image) state.screenshot = image
  }
  return state
}

/** The browser recording tools (`browser_recording_start` / `browser_recording_stop`), by their short action. */
export function recordingAction(name: string): 'start' | 'stop' | null {
  const m = /^(?:[a-z0-9_]+__)?browser_recording_(start|stop)$/.exec(name)
  return m ? (m[1] as 'start' | 'stop') : null
}

const basenameOf = (path: string): string => path.split('/').pop() ?? path

/**
 * A recording tool call as a card: its title ("Started recording", "Saved recording demo.webm") and the video
 * file to open in the side panel (the saved one, or one that stopped by itself, reported with the next call).
 * `null` for other tools.
 */
export function recordingCard(view: Pick<ToolView, 'name' | 'output' | 'status'>): { title: string; file?: string } | null {
  const action = recordingAction(view.name)
  if (action === null) return null
  const out = argsOf(view.output)
  const path = str(out['path'])
  const earlier = argsOf(out['earlier_recording'])
  const earlierPath = str(earlier['path'])
  const failed = view.status === 'failed' || str(out['error']) !== undefined
  if (action === 'start') {
    const title = view.status === 'running' ? 'Starting recording' : failed ? 'Could not start recording' : 'Started recording'
    return earlierPath?.endsWith('.webm') ? { title, file: earlierPath } : { title }
  }
  if (view.status === 'running') return { title: 'Saving recording' }
  if (path?.endsWith('.webm') && !failed) return { title: `Saved recording ${basenameOf(path)}`, file: path }
  return { title: str(out['error']) === 'not_recording' ? 'No recording to stop' : 'Could not save recording' }
}
